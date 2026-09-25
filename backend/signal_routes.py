"""Live future-signal API: upcoming/verified signals, measured accuracy, settings, feed check."""
import time
from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from market_config import FRESHNESS
from market_models import Document

SourceParam = Literal['all', 'deriv', 'market-qx-observer-v2']


class SignalSettingsBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool | None = None
    threshold: int | None = Field(default=None, ge=55, le=99)
    sources: list[Literal['deriv', 'market-qx-observer-v2']] | None = Field(default=None, min_length=1)
    timeframes: list[Literal['1m', '5m', '10m', '15m', '30m', '1h']] | None = Field(default=None, min_length=1)
    minAgree: int | None = Field(default=None, ge=2, le=9)
    maxOppose: int | None = Field(default=None, ge=0, le=4)
    deepScanAfterMinutes: int | None = Field(default=None, ge=5, le=1440)
    deepScanFloor: int | None = Field(default=None, ge=50, le=99)


def signal_router(store, deriv, signals):
    router = APIRouter(prefix='/api/v1/signals')

    async def observer_status():
        status = await store.db.observer_status.find_one({'id': 'current'}, {'_id': 0})
        if not status:
            return {'source': 'market-qx-observer-v2', 'state': 'WAITING_FOR_EXTENSION'}
        age = time.time() - status['lastReceived']
        return {**status, 'source': 'market-qx-observer-v2', 'state': 'DATA_RECEIVING' if age < FRESHNESS else 'STALE', 'ageSeconds': age, 'freshnessSeconds': FRESHNESS}

    @router.get('/live', response_model=Document)
    async def live(source: SourceParam = 'all', limit: int = Query(default=50, ge=1, le=200)):
        return await signals.live(source, limit)

    @router.get('/history', response_model=Document)
    async def history(source: SourceParam = 'all', limit: int = Query(default=200, ge=1, le=1000), status: Literal['PENDING', 'WIN', 'LOSS', 'TIE', 'VOID'] | None = None):
        return await signals.history(source, limit, status)

    @router.get('/stats', response_model=Document)
    async def stats(source: SourceParam = 'all', hours: int = Query(default=24, ge=1, le=720)):
        return await signals.stats(source, hours)

    @router.get('/check', response_model=Document)
    async def check():
        return await signals.check(await observer_status(), deriv.status() if deriv else None)

    @router.get('/settings', response_model=Document)
    async def get_settings():
        return {'settings': dict(signals.settings), 'engine': signals.status()}

    @router.post('/settings', response_model=Document)
    async def update_settings(body: SignalSettingsBody):
        changes = body.model_dump(exclude_none=True)
        if not changes:
            raise HTTPException(422, 'No settings supplied')
        settings = await signals.save_settings(changes)
        return {'ok': True, 'settings': settings, 'persisted': True}

    @router.post('/scan', response_model=Document)
    async def scan():
        """Manual deep scan across all fresh markets (respects the deep-scan floor)."""
        result = await signals.deep_scan(manual=True)
        return {'ok': True, **result}

    return router
