import asyncio
import time
from fastapi import APIRouter, HTTPException, Query
from market_models import Source, AnalysisInput, Document, Items
from market_config import TIMEFRAMES, FRESHNESS


def market_router(store, deriv, analysis):
    router = APIRouter(prefix='/api/v1')

    async def observer_status():
        status = await store.db.observer_status.find_one({'id': 'current'}, {'_id': 0})
        if not status:
            return {'source': 'market-qx-observer-v2', 'state': 'WAITING_FOR_EXTENSION'}
        return {**status, 'source': 'market-qx-observer-v2', 'state': 'DATA_RECEIVING' if time.time() - status['lastReceived'] < FRESHNESS else 'STALE', 'verification': 'UNVERIFIED_BROWSER_OBSERVATION'}

    @router.get('/runtime', response_model=Document)
    async def runtime():
        await store.db.command('ping')
        return {'providers': [deriv.status(), await observer_status()], 'database': 'CONNECTED', 'ticksReceived': store.tick_count, 'analysisCycles': analysis.cycles, 'analysisError': analysis.error, 'agents': {'configuredSlots': 500, 'registered': 0, 'active': 0, 'implemented': 0, 'reason': 'AGENT_SOURCE_MISSING_FROM_REPOSITORY'}, 'masterAgent': {'state': 'NO_SIGNAL', 'reason': 'VALIDATION_REQUIRED'}, 'training': {'state': 'NOT_TRAINED', 'accuracy': None}, 'executionEnabled': False}

    @router.get('/instruments', response_model=Items)
    async def instruments(source: Source | None = None):
        return {'items': await store.db.market_instruments.find({'source': source} if source else {}, {'_id': 0}).limit(1000).to_list(1000)}

    @router.get('/observation', response_model=Document)
    async def observation():
        return await observer_status()

    @router.get('/market/state', response_model=Document)
    async def state(source: Source, symbol: str = Query(min_length=1, max_length=64), timeframe: str = '1m'):
        if timeframe not in TIMEFRAMES:
            raise HTTPException(422, 'Unsupported timeframe')
        instrument = await store.resolve(source, symbol)
        if not instrument:
            return dict(source=source, symbol=symbol, timeframe=timeframe, state='UNAVAILABLE', candles=[], price=None, reason='PAIR_NOT_RECEIVED_FROM_THIS_SOURCE')
        history_error = None
        if source == 'deriv':
            try:
                await asyncio.wait_for(deriv.history(instrument['symbol'], timeframe), 25)
            except Exception:
                history_error = 'HISTORY_UNAVAILABLE'
        rows = await store.candles(source, instrument['symbol'], timeframe)
        last = instrument.get('latestEpoch')
        fresh = last is not None and time.time() - last <= FRESHNESS
        return dict(source=source, symbol=instrument['symbol'], timeframe=timeframe, state='LIVE' if fresh else 'STALE' if rows else 'WAITING', candles=rows, price=instrument.get('latestPrice'), timestamp=last, reason=history_error, provenance=instrument.get('provenance'))

    @router.post('/analysis', response_model=Document)
    async def analyze(body: AnalysisInput):
        if body.timeframe not in TIMEFRAMES:
            raise HTTPException(422, 'Unsupported timeframe')
        instrument = await store.resolve(body.source, body.symbol)
        if not instrument:
            return {'state': 'NO_DATA', 'signal': {'direction': 'NO_SIGNAL', 'reason': 'PAIR_NOT_RECEIVED_FROM_THIS_SOURCE', 'executionOrder': False}}
        try:
            return await analysis.analyze(body.source, instrument['symbol'], body.timeframe)
        except Exception as exc:
            raise HTTPException(503, 'Analysis temporarily unavailable') from exc

    @router.get('/analysis/latest', response_model=Document)
    async def latest(source: Source, symbol: str, timeframe: str = '1m'):
        instrument = await store.resolve(source, symbol)
        result = await store.db.market_analyses.find_one({'source': source, 'symbol': instrument['symbol'] if instrument else symbol, 'timeframe': timeframe}, {'_id': 0})
        return result or {'state': 'NO_DATA', 'signal': {'direction': 'NO_SIGNAL', 'reason': 'WAITING_FOR_ANALYSIS'}}

    @router.get('/top-pairs', response_model=Items)
    async def top_pairs():
        rows = await store.db.market_analyses.find({'timeframe': '1m', 'latestEpoch': {'$gte': time.time() - FRESHNESS - 60}, 'quality.status': 'VALID', 'candleCount': {'$gte': 60}}, {'_id': 0}).sort([('quality.score', -1), ('candleCount', -1)]).limit(15).to_list(15)
        return {'items': [{'source': r['source'], 'symbol': r['symbol'], 'quality': r['quality']['score'], 'candleCount': r['candleCount'], 'signal': 'NO_SIGNAL', 'qualification': 'DATA_QUALITY_ONLY_NOT_WIN_PROBABILITY'} for r in rows]}

    @router.get('/history', response_model=Items)
    async def history(limit: int = Query(50, ge=1, le=200)):
        return {'items': await store.db.signal_history.find({}, {'_id': 0}).sort('createdAt', -1).limit(limit).to_list(limit)}

    @router.get('/events', response_model=Items)
    async def events():
        return {'items': await store.db.runtime_events.find({}, {'_id': 0}).sort('time', -1).limit(50).to_list(50)}

    @router.get('/agents', response_model=Document)
    async def agents():
        return {'registered': 0, 'configuredSlots': 500, 'status': 'MISSING_IMPLEMENTATION', 'items': []}

    @router.get('/modules', response_model=Items)
    async def modules():
        return {'items': [
            {'name': '500 Agents', 'state': 'MISSING_AGENT_SOURCE'},
            {'name': 'Pipeline', 'state': 'CONNECTED', 'engines': ['Pattern Detection Engine', 'Chart Analysis Engine', '50+ Indicator Engine', 'Quality Definition Engine', 'Candle Type Tracking Engine', 'Quality Pipeline Engine']},
            {'name': 'Behaviour Finder', 'state': 'RULE_BASED_CANDIDATES'},
            {'name': 'Algorithm Detection', 'state': 'NOT_IMPLEMENTED'},
            {'name': 'pair Detection', 'state': 'TOP_15_DATA_QUALITY_RANKING'},
            {'name': 'Breakout & Gap Up/Down Detection', 'state': 'OBSERVED_CANDIDATES'},
            {'name': 'Master Agent', 'state': 'NO_SIGNAL_VALIDATION_REQUIRED'},
            {'name': 'Self-Training System', 'state': 'NOT_TRAINED'},
            {'name': 'Trade History', 'state': 'ANALYTICAL_HISTORY_ONLY'},
            {'name': 'Generation', 'state': 'FAIL_CLOSED'},
            {'name': 'Module', 'state': 'ANALYTICAL_OUTPUT_ONLY'},
        ]}
    return router