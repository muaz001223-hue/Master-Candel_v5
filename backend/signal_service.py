"""Live future-signal service.

Every cycle: for each fresh (source, symbol, timeframe) evaluate the closed
candles once per upcoming candle and emit at most one signal per entry epoch.
Signals are verified after expiry against the entry candle's real close so the
displayed accuracy is measured, never assumed. A "deep scan" runs when no
signal has qualified for a configurable idle window: it re-evaluates every
market with higher-timeframe confirmation and emits only the best candidate
that still clears a floor. Missing/stale data always yields NO_SIGNAL.
"""
import asyncio
import logging
import time
import uuid

from market_config import TIMEFRAMES, FRESHNESS
from signal_engine import evaluate, qualifies, outcome, MIN_CANDLES, DEEP_MIN_CANDLES

logger = logging.getLogger(__name__)

SOURCES = ['deriv', 'market-qx-observer-v2']
SIGNAL_TIMEFRAMES = ['1m', '5m', '10m', '15m', '30m', '1h']
HIGHER = {'1m': '5m', '5m': '30m', '10m': '1h', '15m': '1h', '30m': '1h', '1h': None}
DEFAULT_SETTINGS = {
    'enabled': True,
    'threshold': 85,
    'sources': list(SOURCES),
    'timeframes': ['1m', '5m', '10m', '30m', '1h'],
    'minAgree': 4,
    'maxOppose': 1,
    'deepScanAfterMinutes': 60,
    'deepScanFloor': 70,
    'evaluateAfterProgress': 0.5,
}


def label_for(instrument):
    return instrument.get('label') or instrument['symbol']


class SignalService:
    def __init__(self, store, deriv=None):
        self.store = store
        self.db = store.db
        self.deriv = deriv
        self.settings = dict(DEFAULT_SETTINGS)
        self.cycles = 0
        self.last_cycle = None
        self.last_cycle_ms = None
        self.evaluated_last_cycle = 0
        self.last_signal_at = None
        self.last_deep_scan = None
        self.deep_scan_runs = 0
        self.deep_scan_last_result = None
        self.error = None
        self.history_loaded = {}
        self._evaluated = {}  # (source, symbol, tf) -> entry epoch already evaluated
        self._insufficient_retry = {}
        self._task = None
        self._history_task = None

    # ----- settings -----------------------------------------------------------------
    def apply_settings(self, changes):
        for key, value in changes.items():
            if key in DEFAULT_SETTINGS and value is not None:
                self.settings[key] = value
        self.settings['timeframes'] = [t for t in self.settings['timeframes'] if t in TIMEFRAMES and t in SIGNAL_TIMEFRAMES] or ['1m']
        self.settings['sources'] = [s for s in self.settings['sources'] if s in SOURCES] or list(SOURCES)
        self._evaluated.clear()
        return dict(self.settings)

    async def load_settings(self):
        saved = await self.db.runtime_settings.find_one({'id': 'signal_engine'}, {'_id': 0, 'id': 0})
        if saved:
            self.apply_settings(saved)
        await self.db.live_signals.create_index([('source', 1), ('symbol', 1), ('timeframe', 1), ('entryEpoch', 1)], unique=True)
        await self.db.live_signals.create_index([('status', 1), ('expiryEpoch', 1)])
        await self.db.live_signals.create_index([('generatedAt', -1)])
        last = await self.db.live_signals.find_one({}, {'_id': 0, 'generatedAt': 1}, sort=[('generatedAt', -1)])
        if last:
            self.last_signal_at = last['generatedAt']

    async def save_settings(self, changes):
        settings = self.apply_settings(changes)
        await self.db.runtime_settings.update_one({'id': 'signal_engine'}, {'$set': settings}, upsert=True)
        return settings

    # ----- lifecycle ----------------------------------------------------------------
    def start(self):
        self._task = asyncio.create_task(self.run())
        if self.deriv is not None:
            self._history_task = asyncio.create_task(self.warm_history())

    async def stop(self):
        for task in [self._task, self._history_task]:
            if task:
                task.cancel()

    async def run(self):
        while True:
            started = time.time()
            try:
                if self.settings['enabled']:
                    await self.cycle()
                await self.verify_pending()
                self.error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.error = type(exc).__name__
                logger.warning('Signal cycle failed: %s', exc)
            self.cycles += 1
            self.last_cycle = time.time()
            self.last_cycle_ms = int((self.last_cycle - started) * 1000)
            await asyncio.sleep(max(1.0, 5 - (time.time() - started)))

    async def warm_history(self):
        """Keep Deriv provider OHLC history loaded for every signal timeframe (>=1m)."""
        await asyncio.sleep(8)
        while True:
            try:
                symbols = list(getattr(self.deriv, 'symbols', []) or [])
                for symbol in symbols:
                    for timeframe in self.settings['timeframes']:
                        seconds = TIMEFRAMES.get(timeframe, 0)
                        if seconds < 60:
                            continue
                        key = (symbol, timeframe)
                        if time.time() - self.history_loaded.get(key, 0) < max(seconds, 120):
                            continue
                        try:
                            await asyncio.wait_for(self.deriv.history(symbol, timeframe), 20)
                            self.history_loaded[key] = time.time()
                        except asyncio.CancelledError:
                            raise
                        except Exception:  # noqa: BLE001
                            self.history_loaded[key] = time.time() - max(seconds, 120) + 30
                        await asyncio.sleep(0.35)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning('History warm-up failed: %s', exc)
            await asyncio.sleep(10)

    # ----- evaluation ---------------------------------------------------------------
    async def fresh_instruments(self):
        return await self.db.market_instruments.find(
            {'source': {'$in': self.settings['sources']}, 'latestEpoch': {'$gte': time.time() - FRESHNESS}}, {'_id': 0}).limit(200).to_list(200)

    async def closed_candles(self, source, symbol, timeframe, now, limit=300):
        seconds = TIMEFRAMES[timeframe]
        rows = await self.store.candles(source, symbol, timeframe, limit)
        return [c for c in rows if c['epoch'] + seconds <= now]

    async def assess(self, instrument, timeframe, now, deep=False):
        """Evaluate one market for the next candle. Returns (assessment | None, reason, entry_epoch)."""
        source, symbol = instrument['source'], instrument['symbol']
        seconds = TIMEFRAMES[timeframe]
        bucket = int(now // seconds) * seconds
        entry = bucket + seconds
        candles = await self.closed_candles(source, symbol, timeframe, now)
        minimum = DEEP_MIN_CANDLES if deep else MIN_CANDLES
        if len(candles) < minimum:
            return None, f'INSUFFICIENT_CLOSED_CANDLES_{len(candles)}_OF_{minimum}', entry
        # The most recent closed candle must be the one immediately before the forming candle.
        if candles[-1]['epoch'] != bucket - seconds:
            return None, 'GAP_BEFORE_CURRENT_CANDLE', entry
        higher = None
        if deep and HIGHER.get(timeframe):
            higher = await self.closed_candles(source, symbol, HIGHER[timeframe], now, 120)
        assessment = evaluate(candles, higher_timeframe_candles=higher, deep=deep)
        return assessment, assessment.get('reason', ''), entry

    async def cycle(self):
        now = time.time()
        instruments = await self.fresh_instruments()
        evaluated = 0
        emitted = 0
        progress_gate = float(self.settings['evaluateAfterProgress'])
        for instrument in instruments:
            for timeframe in self.settings['timeframes']:
                seconds = TIMEFRAMES[timeframe]
                bucket = int(now // seconds) * seconds
                if (now - bucket) / seconds < progress_gate:
                    continue
                key = (instrument['source'], instrument['symbol'], timeframe)
                entry = bucket + seconds
                if self._evaluated.get(key) == entry:
                    continue
                retry_at = self._insufficient_retry.get(key)
                if retry_at and now < retry_at:
                    continue
                assessment, reason, entry = await self.assess(instrument, timeframe, now)
                evaluated += 1
                if assessment is None:
                    if reason.startswith('INSUFFICIENT'):
                        self._insufficient_retry[key] = now + 60
                    else:
                        self._evaluated[key] = entry
                    continue
                self._evaluated[key] = entry
                ok, gate = qualifies(assessment, self.settings['threshold'], self.settings['minAgree'], self.settings['maxOppose'])
                if ok:
                    if await self.emit(instrument, timeframe, entry, assessment, 'STANDARD'):
                        emitted += 1
        self.evaluated_last_cycle = evaluated
        idle_for = now - (self.last_signal_at or 0)
        deep_after = self.settings['deepScanAfterMinutes'] * 60
        if not emitted and idle_for >= deep_after and (self.last_deep_scan is None or now - self.last_deep_scan >= 300):
            await self.deep_scan(instruments, now)

    async def deep_scan(self, instruments=None, now=None, manual=False):
        """Re-evaluate every fresh market with higher-timeframe confirmation; emit only the best candidate."""
        now = now or time.time()
        instruments = instruments if instruments is not None else await self.fresh_instruments()
        self.last_deep_scan = now
        self.deep_scan_runs += 1
        best = None
        scanned = 0
        for instrument in instruments:
            for timeframe in self.settings['timeframes']:
                seconds = TIMEFRAMES[timeframe]
                bucket = int(now // seconds) * seconds
                if (now - bucket) / seconds < 0.3 and not manual:
                    continue
                entry = bucket + seconds
                if await self.db.live_signals.find_one({'source': instrument['source'], 'symbol': instrument['symbol'], 'timeframe': timeframe, 'entryEpoch': entry}, {'_id': 1}):
                    continue
                assessment, _reason, entry = await self.assess(instrument, timeframe, now, deep=True)
                if assessment is None:
                    continue
                scanned += 1
                ok, _gate = qualifies(assessment, self.settings['deepScanFloor'], max(3, self.settings['minAgree'] - 1), self.settings['maxOppose'])
                if ok and (best is None or assessment['confidence'] > best[3]['confidence']):
                    best = (instrument, timeframe, entry, assessment)
        result = {'at': now, 'scanned': scanned, 'emitted': None, 'manual': manual}
        if best:
            instrument, timeframe, entry, assessment = best
            if await self.emit(instrument, timeframe, entry, assessment, 'DEEP_SCAN'):
                result['emitted'] = {'symbol': instrument['symbol'], 'timeframe': timeframe, 'direction': assessment['direction'], 'confidence': assessment['confidence']}
        self.deep_scan_last_result = result
        return result

    async def emit(self, instrument, timeframe, entry, assessment, mode):
        seconds = TIMEFRAMES[timeframe]
        now = time.time()
        document = {
            'id': str(uuid.uuid4()), 'source': instrument['source'], 'symbol': instrument['symbol'], 'label': label_for(instrument),
            'timeframe': timeframe, 'timeframeSeconds': seconds, 'direction': assessment['direction'], 'confidence': assessment['confidence'],
            'mode': mode, 'status': 'PENDING', 'generatedAt': now, 'entryEpoch': entry, 'expiryEpoch': entry + seconds,
            'agreeing': assessment['agreeing'], 'opposing': assessment['opposing'], 'penalties': assessment['penalties'],
            'votes': {k: {'direction': v['direction'], 'detail': v['detail']} for k, v in assessment['votes'].items()},
            'indicators': assessment['indicators'], 'higherTimeframe': assessment.get('higherTimeframe'),
            'provenance': 'LIVE_DERIV_PUBLIC' if instrument['source'] == 'deriv' else 'BROWSER_OBSERVED_UNVERIFIED',
            'threshold': self.settings['threshold'] if mode == 'STANDARD' else self.settings['deepScanFloor'],
        }
        try:
            await self.db.live_signals.insert_one(document)
        except Exception:  # duplicate for this entry epoch -> another cycle already emitted it
            return False
        self.last_signal_at = now
        await self.store.event('SIGNAL', 'Signal Engine', f"{document['label']} · {timeframe} · {assessment['direction']} · {assessment['confidence']}% · {mode} · entry {time.strftime('%H:%M', time.gmtime(entry))} UTC")
        return True

    # ----- verification -------------------------------------------------------------
    async def verify_pending(self):
        now = time.time()
        pending = await self.db.live_signals.find({'status': 'PENDING', 'expiryEpoch': {'$lte': now - 3}}, {'_id': 0}).limit(200).to_list(200)
        for signal in pending:
            candle = await self.db.market_candles.find_one({'source': signal['source'], 'symbol': signal['symbol'], 'timeframe': signal['timeframe'], 'epoch': signal['entryEpoch']}, {'_id': 0})
            update = None
            if candle:
                result = outcome(signal['direction'], candle)
                update = {'status': result, 'verifiedAt': now, 'entryOpen': candle['open'], 'exitClose': candle['close'], 'entryCandleCompleteness': candle.get('completeness'), 'verification': 'ENTRY_CANDLE_OPEN_VS_CLOSE'}
            elif now > signal['expiryEpoch'] + 2 * signal['timeframeSeconds'] + 30:
                update = {'status': 'VOID', 'verifiedAt': now, 'verification': 'NO_ENTRY_CANDLE_DATA'}
            if update:
                await self.db.live_signals.update_one({'id': signal['id']}, {'$set': update})
                if update['status'] in ('WIN', 'LOSS'):
                    await self.store.event('SIGNAL', 'Signal Engine', f"{signal['label']} · {signal['timeframe']} · {signal['direction']} → {update['status']}")

    # ----- reporting ----------------------------------------------------------------
    def _source_filter(self, source):
        if source and source != 'all':
            return {'source': source}
        return {'source': {'$in': SOURCES}}

    async def live(self, source='all', limit=50):
        now = time.time()
        base = self._source_filter(source)
        upcoming = await self.db.live_signals.find({**base, 'status': 'PENDING', 'expiryEpoch': {'$gte': now - 3}}, {'_id': 0}).sort('entryEpoch', 1).limit(limit).to_list(limit)
        recent = await self.db.live_signals.find({**base, 'status': {'$ne': 'PENDING'}}, {'_id': 0}).sort('generatedAt', -1).limit(limit).to_list(limit)
        return {'now': now, 'upcoming': upcoming, 'recent': recent, 'engine': self.status()}

    async def history(self, source='all', limit=200, status=None):
        query = self._source_filter(source)
        if status:
            query['status'] = status
        rows = await self.db.live_signals.find(query, {'_id': 0}).sort('generatedAt', -1).limit(limit).to_list(limit)
        return {'items': rows}

    async def stats(self, source='all', hours=24):
        since = time.time() - hours * 3600
        base = {**self._source_filter(source), 'generatedAt': {'$gte': since}}
        pipeline = [{'$match': base}, {'$group': {'_id': {'source': '$source', 'timeframe': '$timeframe', 'status': '$status'}, 'n': {'$sum': 1}}}]
        rows = await self.db.live_signals.aggregate(pipeline).to_list(1000)
        by_tf, by_source, overall = {}, {}, {'WIN': 0, 'LOSS': 0, 'TIE': 0, 'PENDING': 0, 'VOID': 0}
        for row in rows:
            key = row['_id']
            for bucket in (by_tf.setdefault(key['timeframe'], dict(overall)), by_source.setdefault(key['source'], dict(overall)), overall):
                bucket[key['status']] = bucket.get(key['status'], 0) + row['n']

        def finish(bucket):
            decided = bucket['WIN'] + bucket['LOSS']
            return {**bucket, 'decided': decided, 'accuracy': round(bucket['WIN'] / decided * 100, 1) if decided else None}
        pairs = await self.db.live_signals.aggregate([{'$match': base}, {'$group': {'_id': {'source': '$source', 'symbol': '$symbol', 'label': '$label'}, 'win': {'$sum': {'$cond': [{'$eq': ['$status', 'WIN']}, 1, 0]}}, 'loss': {'$sum': {'$cond': [{'$eq': ['$status', 'LOSS']}, 1, 0]}}, 'pending': {'$sum': {'$cond': [{'$eq': ['$status', 'PENDING']}, 1, 0]}}, 'total': {'$sum': 1}}}, {'$sort': {'total': -1}}, {'$limit': 100}]).to_list(100)
        return {
            'hours': hours, 'source': source,
            'overall': finish(overall),
            'byTimeframe': {k: finish(v) for k, v in by_tf.items()},
            'bySource': {k: finish(v) for k, v in by_source.items()},
            'byPair': [{'source': p['_id']['source'], 'symbol': p['_id']['symbol'], 'label': p['_id'].get('label') or p['_id']['symbol'], 'win': p['win'], 'loss': p['loss'], 'pending': p['pending'], 'total': p['total'], 'accuracy': round(p['win'] / (p['win'] + p['loss']) * 100, 1) if p['win'] + p['loss'] else None} for p in pairs],
            'measurement': 'ENTRY_CANDLE_OPEN_VS_CLOSE',
        }

    def status(self):
        now = time.time()
        idle = now - self.last_signal_at if self.last_signal_at else None
        return {
            'enabled': self.settings['enabled'], 'settings': dict(self.settings), 'cycles': self.cycles, 'lastCycle': self.last_cycle,
            'lastCycleMs': self.last_cycle_ms, 'evaluatedLastCycle': self.evaluated_last_cycle, 'lastSignalAt': self.last_signal_at,
            'idleSeconds': idle, 'deepScan': {'active': idle is not None and idle >= self.settings['deepScanAfterMinutes'] * 60 or self.last_signal_at is None,
                                              'runs': self.deep_scan_runs, 'last': self.last_deep_scan, 'lastResult': self.deep_scan_last_result},
            'error': self.error, 'historyKeysLoaded': len(self.history_loaded),
        }

    async def check(self, observer_status=None, deriv_status=None):
        """Is the Quotex observer stream delivering usable signal input?"""
        now = time.time()
        per_source = {}
        for source in SOURCES:
            instruments = await self.db.market_instruments.find({'source': source}, {'_id': 0, 'symbol': 1, 'label': 1, 'latestEpoch': 1, 'latestPrice': 1}).to_list(500)
            fresh = [i for i in instruments if i.get('latestEpoch') and now - i['latestEpoch'] <= FRESHNESS]
            candles = {}
            for timeframe in self.settings['timeframes']:
                seconds = TIMEFRAMES[timeframe]
                ready = 0
                for instrument in fresh[:60]:
                    count = await self.db.market_candles.count_documents({'source': source, 'symbol': instrument['symbol'], 'timeframe': timeframe, 'epoch': {'$lte': now - seconds}})
                    if count >= MIN_CANDLES:
                        ready += 1
                candles[timeframe] = {'pairsReady': ready, 'required': MIN_CANDLES}
            signals_1h = await self.db.live_signals.count_documents({'source': source, 'generatedAt': {'$gte': now - 3600}})
            signals_24h = await self.db.live_signals.count_documents({'source': source, 'generatedAt': {'$gte': now - 86400}})
            last = await self.db.live_signals.find_one({'source': source}, {'_id': 0, 'label': 1, 'timeframe': 1, 'direction': 1, 'confidence': 1, 'entryEpoch': 1, 'status': 1, 'generatedAt': 1}, sort=[('generatedAt', -1)])
            per_source[source] = {
                'pairsKnown': len(instruments), 'pairsFresh': len(fresh),
                'freshPairs': [{'symbol': i['symbol'], 'label': i.get('label') or i['symbol'], 'ageSeconds': round(now - i['latestEpoch'], 1), 'price': i.get('latestPrice')} for i in sorted(fresh, key=lambda x: -x['latestEpoch'])[:40]],
                'candlesReady': candles, 'signalsLastHour': signals_1h, 'signalsLast24h': signals_24h, 'lastSignal': last,
            }
        observer = per_source['market-qx-observer-v2']
        verdict = 'NOT_CONNECTED'
        if observer_status and observer_status.get('state') in ('DATA_RECEIVING', 'STALE'):
            verdict = 'RECEIVING' if observer_status.get('state') == 'DATA_RECEIVING' else 'STALE'
        if verdict == 'RECEIVING' and not any(v['pairsReady'] for v in observer['candlesReady'].values()):
            verdict = 'RECEIVING_WARMING_UP'
        if verdict == 'RECEIVING' and observer['signalsLast24h']:
            verdict = 'RECEIVING_SIGNALS_ACTIVE'
        return {'now': now, 'verdict': verdict, 'observer': observer_status, 'deriv': deriv_status, 'sources': per_source, 'engine': self.status(),
                'freshnessSeconds': FRESHNESS, 'noFakeData': 'Signals require live closed candles; stale or missing input yields NO_SIGNAL.'}
