"""New Deriv Options public API. Never sends account tokens or authorize."""
import asyncio
import json
import logging
import time
from contextlib import suppress
import websockets
from market_config import DERIV_URL, DERIV_SYMBOLS, DERIV_ENABLED, TIMEFRAMES, FRESHNESS

logger = logging.getLogger(__name__)


class DerivService:
    def __init__(self, store):
        self.store = store
        self.state = 'CONNECTING' if DERIV_ENABLED else 'DISABLED'
        self.last_error = None
        self.last_tick = None
        self.symbols = []
        self.task = None
        self.history_locks = {}
        self.history_loaded = {}
        self.semaphore = asyncio.Semaphore(3)
        self.accepted = set()
        self.rejected = {}
        self.request_symbols = {}

    async def request(self, body):
        async with self.semaphore:
            async with websockets.connect(DERIV_URL, open_timeout=15, close_timeout=3, max_size=2**22) as ws:
                await ws.send(json.dumps(body))
                message = json.loads(await asyncio.wait_for(ws.recv(), 20))
                if message.get('error') or message.get('errors'):
                    raise ValueError('DERIV_REQUEST_REJECTED')
                return message

    async def discover(self):
        payload = await self.request({'active_symbols': 'brief'})
        self.symbols = []
        for row in payload.get('active_symbols', []):
            symbol = row.get('underlying_symbol') or row.get('symbol')
            if not symbol:
                continue
            label = row.get('underlying_symbol_name') or row.get('display_name') or symbol
            await self.store.instrument('deriv', symbol, label, market=row.get('market'), available=bool(row.get('exchange_is_open', True)) and not bool(row.get('is_trading_suspended', False)), supportedTimeframes=list(TIMEFRAMES), provenance='DERIV_PUBLIC_API')
            if symbol in DERIV_SYMBOLS:
                self.symbols.append(symbol)
        if not self.symbols:
            raise ValueError('NO_CONFIGURED_SYMBOLS_AVAILABLE')

    async def history(self, symbol, timeframe):
        if TIMEFRAMES[timeframe] < 60:
            return
        key = (symbol, timeframe)
        async with self.history_locks.setdefault(key, asyncio.Lock()):
            if time.time() - self.history_loaded.get(key, 0) < 60:
                return
            response = await self.request({'ticks_history': symbol, 'end': 'latest', 'count': 300, 'style': 'candles', 'granularity': TIMEFRAMES[timeframe]})
            now = time.time()
            rows = [self.store.candle('deriv', symbol, timeframe, int(c['epoch']), float(c['open']), float(c['high']), float(c['low']), float(c['close']), method='DERIV_HISTORY', completeness='PROVIDER_OHLC') for c in response.get('candles', []) if int(c['epoch']) + TIMEFRAMES[timeframe] <= now]
            await self.store.save_candles(rows)
            self.history_loaded[key] = time.time()

    async def warm(self):
        for symbol in self.symbols:
            try:
                await self.history(symbol, '1m')
            except Exception:
                logger.warning('Deriv history unavailable for %s', symbol)

    async def run(self):
        delay = 1
        while True:
            warm = ping = None
            try:
                self.state = 'CONNECTING'
                self.accepted.clear()
                self.rejected.clear()
                self.request_symbols.clear()
                await self.discover()
                async with websockets.connect(DERIV_URL, open_timeout=15, close_timeout=3, ping_interval=20, ping_timeout=20, max_size=2**22) as ws:
                    for request_id, symbol in enumerate(self.symbols, 1):
                        self.request_symbols[request_id] = symbol
                        await ws.send(json.dumps({'ticks': symbol, 'subscribe': 1, 'req_id': request_id}))
                        await asyncio.sleep(.04)
                    self.state = 'CONNECTED'
                    self.last_error = None
                    delay = 1
                    await self.store.event('INFO', 'Deriv', f'Public stream connected · {len(self.symbols)} subscriptions requested')
                    warm = asyncio.create_task(self.warm())
                    async def keepalive():
                        while True:
                            await asyncio.sleep(30)
                            await ws.send(json.dumps({'ping': 1}))
                    ping = asyncio.create_task(keepalive())
                    while True:
                        data = json.loads(await asyncio.wait_for(ws.recv(), 65))
                        if data.get('error') or data.get('errors'):
                            symbol = self.request_symbols.get(data.get('req_id')) or data.get('echo_req', {}).get('ticks')
                            error = data.get('error') or (data.get('errors') or [{}])[0]
                            code = error.get('code', 'PROVIDER_REJECTED')
                            if symbol in self.symbols:
                                self.rejected[symbol] = code
                                self.accepted.discard(symbol)
                                await self.store.db.market_instruments.update_one({'source': 'deriv', 'symbol': symbol}, {'$set': {'subscriptionState': 'REJECTED', 'subscriptionReason': code}})
                                await self.store.event('WARN', 'Deriv', f'{symbol} subscription unavailable · {code}')
                            else:
                                self.last_error = code
                            continue
                        tick = data.get('tick')
                        if tick and tick.get('symbol') in self.symbols:
                            try:
                                await self.store.tick('deriv', tick['symbol'], float(tick['quote']), float(tick['epoch']), 'DERIV_PUBLIC_TICK')
                                if tick['symbol'] not in self.accepted:
                                    await self.store.db.market_instruments.update_one({'source': 'deriv', 'symbol': tick['symbol']}, {'$set': {'subscriptionState': 'ACCEPTED', 'subscriptionReason': None}})
                                self.accepted.add(tick['symbol'])
                                self.rejected.pop(tick['symbol'], None)
                                self.last_tick = float(tick['epoch'])
                                self.state = 'DATA_RECEIVING'
                            except ValueError:
                                continue
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.state = 'DISCONNECTED'
                self.last_error = type(exc).__name__
                logger.warning('Deriv disconnected: %s', type(exc).__name__)
                await self.store.event('WARN', 'Deriv', f'Connection unavailable · {type(exc).__name__} · retrying')
            finally:
                self.accepted.clear()
                for task in [warm, ping]:
                    if task:
                        task.cancel()
                        with suppress(asyncio.CancelledError):
                            await task
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)

    def status(self):
        age = None if self.last_tick is None else time.time() - self.last_tick
        state = 'STALE' if self.state == 'DATA_RECEIVING' and age is not None and age > FRESHNESS else self.state
        return dict(source='deriv', state=state, lastTick=self.last_tick, ageSeconds=age, symbolCount=len(self.accepted), requestedCount=len(self.symbols), acceptedCount=len(self.accepted), rejectedCount=len(self.rejected), acceptedSymbols=sorted(self.accepted), rejectedSymbols=[{'symbol': k, 'code': v} for k, v in sorted(self.rejected.items())], pendingSymbols=sorted(set(self.symbols) - self.accepted - self.rejected.keys()), error=self.last_error)