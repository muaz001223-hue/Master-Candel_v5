import asyncio
import math
import time
from datetime import datetime, timezone, timedelta
from pymongo import ASCENDING, UpdateOne
from market_config import TIMEFRAMES, FRESHNESS
from market_models import iso


def identity(symbol: str) -> str:
    return ''.join(c for c in symbol.upper() if c.isalnum() or c == '_')


class MarketStore:
    def __init__(self, db):
        self.db = db
        self.locks = {}
        self.last_ticks = {}
        self.tick_count = 0

    async def initialize(self):
        for name, keys in [('market_instruments', ['source', 'symbol']), ('market_candles', ['source', 'symbol', 'timeframe', 'epoch']), ('market_analyses', ['source', 'symbol', 'timeframe']), ('observer_receipts', ['session_id', 'dedupe_id']), ('signal_history', ['source', 'symbol', 'timeframe', 'candleEpoch'])]:
            await self.db[name].create_index([(k, ASCENDING) for k in keys], unique=True)
        await self.db.market_ticks.create_index('expires_at', expireAfterSeconds=0)
        await self.db.observer_receipts.create_index('expires_at', expireAfterSeconds=0)
        await self.db.market_ticks.create_index([('source', 1), ('symbol', 1), ('epoch', -1)])
        await self.db.signal_history.create_index('createdAt')
        await self.db.demo_accounts.create_index('id', unique=True)

    async def instrument(self, source, symbol, label=None, **fields):
        await self.db.market_instruments.update_one({'source': source, 'symbol': symbol}, {'$set': {'label': label or symbol, 'identity': identity(label or symbol), **fields}}, upsert=True)

    async def resolve(self, source, symbol):
        return await self.db.market_instruments.find_one({'source': source, '$or': [{'symbol': symbol}, {'identity': identity(symbol)}]}, {'_id': 0})

    def candle(self, source, symbol, timeframe, timestamp, o, h, low, close, **extra):
        seconds = TIMEFRAMES[timeframe]
        return dict(source=source, symbol=symbol, timeframe=timeframe, epoch=int(timestamp), open=o, high=h, low=low, close=close, volume=None, openTimestamp=iso(timestamp), closeTimestamp=iso(timestamp + seconds), provider=source, instrumentId=f'{source}:{symbol}', **extra)

    async def save_candles(self, candles):
        operations = []
        for candle in candles:
            if not all(math.isfinite(candle[k]) and candle[k] > 0 for k in ['open', 'high', 'low', 'close']):
                continue
            if candle['low'] > min(candle['open'], candle['close']) or candle['high'] < max(candle['open'], candle['close']):
                continue
            key = {k: candle[k] for k in ['source', 'symbol', 'timeframe', 'epoch']}
            operations.append(UpdateOne(key, {'$set': candle}, upsert=True))
        if operations:
            await self.db.market_candles.bulk_write(operations, ordered=False)

    async def tick(self, source, symbol, price, timestamp, method):
        if not math.isfinite(price) or price <= 0 or not math.isfinite(timestamp) or timestamp > time.time() + 2 or time.time() - timestamp > FRESHNESS:
            raise ValueError('INVALID_OR_STALE_TICK')
        key = (source, symbol)
        async with self.locks.setdefault(key, asyncio.Lock()):
            previous = self.last_ticks.get(key)
            if previous is None:
                saved = await self.db.market_instruments.find_one({'source': source, 'symbol': symbol}, {'_id': 0, 'latestEpoch': 1, 'latestPrice': 1})
                if saved and saved.get('latestEpoch') is not None:
                    previous = (saved['latestEpoch'], saved['latestPrice'])
            if previous and timestamp < previous[0]:
                raise ValueError('OUT_OF_ORDER_TICK')
            if previous == (timestamp, price):
                return False
            for timeframe, seconds in TIMEFRAMES.items():
                bucket = int(timestamp // seconds) * seconds
                selector = dict(source=source, symbol=symbol, timeframe=timeframe, epoch=bucket)
                candle = self.candle(source, symbol, timeframe, bucket, price, price, price, price, method=method)
                # Receipt-time buckets are marked PARTIAL; no fabricated closed-candle claim.
                fields = {k: v for k, v in candle.items() if k not in ['high', 'low', 'close']}
                await self.db.market_candles.update_one(selector, {'$setOnInsert': fields, '$max': {'high': price}, '$min': {'low': price}, '$set': {'close': price, 'completeness': 'PARTIAL_TICK_COVERAGE'}}, upsert=True)
            await self.db.market_ticks.insert_one({'source': source, 'symbol': symbol, 'epoch': timestamp, 'price': price, 'method': method, 'expires_at': datetime.now(timezone.utc) + timedelta(days=2)})
            await self.db.market_instruments.update_one({'source': source, 'symbol': symbol}, {'$set': {'latestPrice': price, 'latestEpoch': timestamp, 'method': method}})
            self.last_ticks[key] = (timestamp, price)
            self.tick_count += 1
            return True

    async def candles(self, source, symbol, timeframe, limit=300):
        rows = await self.db.market_candles.find({'source': source, 'symbol': symbol, 'timeframe': timeframe}, {'_id': 0}).sort('epoch', -1).limit(limit).to_list(limit)
        return list(reversed(rows))

    async def event(self, level, source, message):
        await self.db.runtime_events.insert_one({'time': iso(time.time()), 'level': level, 'source': source, 'message': message})