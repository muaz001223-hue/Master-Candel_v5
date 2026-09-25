import asyncio
import time
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from market_auth import require_observer_key
from market_models import ObservedPairs, ObservedTick, ObservedCandle, Document, epoch

SOURCE = 'market-qx-observer-v2'


def observation_router(store):
    router = APIRouter(prefix='/api/v1/observation', dependencies=[Depends(require_observer_key)])
    # Serialize receipts through processing; retries are idempotent even after worker restarts.
    lock = asyncio.Lock()

    @router.get('/check', response_model=Document)
    async def check():
        return {'ok': True, 'source': SOURCE, 'schema_version': 2}

    async def ingest(kind, body):
        async with lock:
            receipt = {'session_id': body.session_id, 'dedupe_id': body.dedupe_id}
            if await store.db.observer_receipts.find_one(receipt, {'_id': 0}):
                return {'ok': True, 'duplicate': True}
            if kind == 'pairs':
                for pair in body.pairs:
                    await store.instrument(SOURCE, pair.symbol, pair.symbol, available=True, provenance='BROWSER_OBSERVED_UNVERIFIED', session_id=body.session_id)
            else:
                instrument = await store.resolve(SOURCE, body.symbol)
                if not instrument:
                    # Discovery can legitimately be lost during MV3 worker suspension.
                    await store.instrument(SOURCE, body.symbol, body.symbol, available=True, provenance='BROWSER_OBSERVED_UNVERIFIED', session_id=body.session_id)
                try:
                    if kind == 'tick':
                        await store.tick(SOURCE, body.symbol, body.price, epoch(body.timestamp), 'VISIBLE_DOM_RECEIPT_TIME')
                    else:
                        candle = store.candle(SOURCE, body.symbol, body.timeframe, epoch(body.timestamp), body.open, body.high, body.low, body.close, method='VISIBLE_DOM_OHLC', completeness='OBSERVED_UNVERIFIED')
                        candle['volume'] = body.volume
                        await store.save_candles([candle])
                        await store.db.market_instruments.update_one({'source': SOURCE, 'symbol': body.symbol, '$or': [{'latestEpoch': {'$lte': epoch(body.closeTimestamp)}}, {'latestEpoch': {'$exists': False}}]}, {'$set': {'latestEpoch': epoch(body.closeTimestamp), 'latestPrice': body.close, 'method': 'VISIBLE_DOM_OHLC'}})
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
            await store.db.observer_receipts.insert_one({**receipt, 'kind': kind, 'expires_at': datetime.now(timezone.utc) + timedelta(days=7)})
            if kind != 'pairs':
                await store.db.observer_status.update_one({'id': 'current'}, {'$set': {'lastReceived': time.time(), 'session_id': body.session_id, 'state': 'DATA_RECEIVING'}}, upsert=True)
            return {'ok': True, 'duplicate': False, 'source': SOURCE, 'verification': 'BROWSER_OBSERVED_UNVERIFIED'}

    @router.post('/pairs', response_model=Document)
    async def pairs(body: ObservedPairs):
        return await ingest('pairs', body)

    @router.post('/tick', response_model=Document)
    async def tick(body: ObservedTick):
        return await ingest('tick', body)

    @router.post('/event', response_model=Document)
    async def candle(body: ObservedCandle):
        return await ingest('event', body)

    return router