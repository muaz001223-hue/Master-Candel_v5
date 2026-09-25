import asyncio
import os
from pathlib import Path
from contextlib import asynccontextmanager, suppress
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime, timezone
import uuid
from market_config import ORIGINS, DERIV_ENABLED
from market_store import MarketStore
from deriv_service import DerivService
from market_analysis import AnalysisService
from market_routes import market_router
from observation_routes import observation_router
from extension_download import router as download_router
from demo_routes import demo_router
from postgres_service import PostgresService
from postgres_routes import postgres_router

client = AsyncIOMotorClient(os.environ['MONGO_URL'], serverSelectionTimeoutMS=5000)
db = client[os.environ['DB_NAME']]
store = MarketStore(db)
deriv = DerivService(store)
analysis = AnalysisService(store)
postgres = PostgresService()
store.mirror = postgres


@asynccontextmanager
async def lifespan(app):
    await store.initialize()
    await store.event('INFO', 'Main Server Core', 'MongoDB connected · analytical ingestion ready')
    saved = await db.runtime_settings.find_one({'id': 'postgres_mirror'}, {'_id': 0, 'id': 0})
    if saved:
        postgres.update_settings(**saved)
    await postgres.connect()
    if postgres.enabled:
        await store.event('INFO' if postgres.state == 'CONNECTED' else 'WARN', 'Main Server Core', f'PostgreSQL {postgres.state}')
    tasks = [asyncio.create_task(analysis.run())]
    if DERIV_ENABLED:
        tasks.append(asyncio.create_task(deriv.run()))
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task
    await analysis.stop_worker()
    await postgres.close()
    client.close()


app = FastAPI(title='Master Candle market backend', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=False, allow_methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Content-Type', 'X-Market-QX-Key'])
app.include_router(market_router(store, deriv, analysis))
app.include_router(observation_router(store, postgres))
app.include_router(download_router)
app.include_router(demo_router(db))
app.include_router(postgres_router(db, postgres))


@app.get('/api/health')
async def health():
    await db.command('ping')
    return {'status': 'ok', 'database': 'connected', 'postgres': await postgres.ping(), 'executionEnabled': False}


@app.get('/api/')
async def root():
    return {'message': 'Master Candle analytical backend'}


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


@app.post('/api/status', response_model=StatusCheck)
async def create_status_check(body: StatusCheckCreate):
    result = StatusCheck(client_name=body.client_name)
    await db.status_checks.insert_one(result.model_dump(mode='json'))
    return result


@app.get('/api/status', response_model=list[StatusCheck])
async def get_status_checks():
    return await db.status_checks.find({}, {'_id': 0}).limit(1000).to_list(1000)