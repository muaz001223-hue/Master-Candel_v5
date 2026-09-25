"""Optional PostgreSQL connection. MongoDB stays the primary store; Postgres is
an additional configured database whose connection health is reported by
/api/health. Missing DATABASE_URL or an unreachable server never blocks startup."""
import asyncio
import logging
import os
import ssl
import time

try:
    import asyncpg
except ImportError:  # pragma: no cover - dependency is optional at runtime
    asyncpg = None

logger = logging.getLogger('postgres')


class PostgresService:
    def __init__(self):
        self.url = os.environ.get('DATABASE_URL', '').strip()
        self.enabled = bool(self.url) and asyncpg is not None
        self.pool_min = int(os.environ.get('DATABASE_POOL_MIN', '1') or 1)
        self.pool_max = int(os.environ.get('DATABASE_POOL_MAX', '5') or 5)
        self.use_ssl = os.environ.get('DATABASE_SSL', 'true').lower() == 'true'
        self.pool = None
        self.state = 'DISABLED' if not self.enabled else 'CONNECTING'
        self.error = None
        self.connected_at = None
        self.mirrored = {'ticks': 0, 'candles': 0, 'failed': 0}
        self._tasks = set()

    def _ssl_context(self):
        if not self.use_ssl:
            return False
        context = ssl.create_default_context()
        return context

    async def connect(self):
        if not self.enabled:
            return
        try:
            self.pool = await asyncpg.create_pool(
                dsn=self.url,
                min_size=max(1, min(self.pool_min, self.pool_max)),
                max_size=max(1, self.pool_max),
                ssl=self._ssl_context(),
                timeout=15,
                command_timeout=30,
            )
            async with self.pool.acquire() as conn:
                await conn.execute(
                    'CREATE TABLE IF NOT EXISTS runtime_health ('
                    'id TEXT PRIMARY KEY, service TEXT NOT NULL, '
                    'last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW())'
                )
                await conn.execute(
                    'INSERT INTO runtime_health (id, service, last_seen) VALUES ($1, $2, NOW()) '
                    'ON CONFLICT (id) DO UPDATE SET last_seen = NOW()',
                    'master-candle-backend', 'Master Candle analytical backend',
                )
                # Mirror tables for browser-observed market data (MongoDB remains primary).
                await conn.execute(
                    'CREATE TABLE IF NOT EXISTS observer_ticks ('
                    'id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL, '
                    'price DOUBLE PRECISION NOT NULL, epoch DOUBLE PRECISION NOT NULL, '
                    'method TEXT, session_id TEXT, dedupe_id TEXT, '
                    'received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), '
                    'UNIQUE (session_id, dedupe_id))'
                )
                await conn.execute(
                    'CREATE INDEX IF NOT EXISTS observer_ticks_symbol_epoch ON observer_ticks (source, symbol, epoch DESC)'
                )
                await conn.execute(
                    'CREATE TABLE IF NOT EXISTS observer_candles ('
                    'source TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, '
                    'epoch BIGINT NOT NULL, open DOUBLE PRECISION NOT NULL, high DOUBLE PRECISION NOT NULL, '
                    'low DOUBLE PRECISION NOT NULL, close DOUBLE PRECISION NOT NULL, volume DOUBLE PRECISION, '
                    'close_epoch DOUBLE PRECISION, method TEXT, completeness TEXT, session_id TEXT, dedupe_id TEXT, '
                    'received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), '
                    'PRIMARY KEY (source, symbol, timeframe, epoch))'
                )
            self.state = 'CONNECTED'
            self.error = None
            self.connected_at = time.time()
            logger.info('PostgreSQL connected')
        except Exception as exc:  # noqa: BLE001 - report, never crash the app
            self.state = 'UNAVAILABLE'
            self.error = type(exc).__name__
            logger.warning('PostgreSQL unavailable: %s', exc)

    async def ping(self):
        if not self.enabled:
            return {'enabled': False, 'state': 'DISABLED'}
        if self.pool is None:
            await self.connect()
        if self.pool is None:
            return {'enabled': True, 'state': self.state, 'error': self.error}
        try:
            async with self.pool.acquire() as conn:
                await asyncio.wait_for(conn.execute('SELECT 1'), timeout=5)
            self.state = 'CONNECTED'
            return {'enabled': True, 'state': 'CONNECTED', 'mirror': await self.mirror_counts()}
        except Exception as exc:  # noqa: BLE001
            self.state = 'UNAVAILABLE'
            self.error = type(exc).__name__
            return {'enabled': True, 'state': 'UNAVAILABLE', 'error': self.error}

    def _spawn(self, coro):
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, kind, sql, *args):
        if self.pool is None:
            self.mirrored['failed'] += 1
            return
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(sql, *args)
            self.mirrored[kind] += 1
        except Exception as exc:  # noqa: BLE001 - mirror must never break ingestion
            self.mirrored['failed'] += 1
            self.error = type(exc).__name__
            logger.warning('PostgreSQL mirror %s failed: %s', kind, exc)

    def mirror_tick(self, source, symbol, price, epoch, method, session_id=None, dedupe_id=None):
        """Non-blocking copy of an observed tick; duplicates are ignored by the unique key."""
        if not self.enabled:
            return
        self._spawn(self._run(
            'ticks',
            'INSERT INTO observer_ticks (source, symbol, price, epoch, method, session_id, dedupe_id) '
            'VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id, dedupe_id) DO NOTHING',
            source, symbol, float(price), float(epoch), method, session_id, dedupe_id,
        ))

    def mirror_candle(self, candle, session_id=None, dedupe_id=None):
        """Non-blocking upsert of an observed OHLC candle keyed by source/symbol/timeframe/epoch."""
        if not self.enabled:
            return
        close_epoch = None
        if candle.get('closeTimestamp'):
            try:
                from datetime import datetime
                close_epoch = datetime.fromisoformat(candle['closeTimestamp']).timestamp()
            except ValueError:
                close_epoch = None
        self._spawn(self._run(
            'candles',
            'INSERT INTO observer_candles (source, symbol, timeframe, epoch, open, high, low, close, volume, close_epoch, method, completeness, session_id, dedupe_id) '
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) '
            'ON CONFLICT (source, symbol, timeframe, epoch) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, '
            'low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume, close_epoch = EXCLUDED.close_epoch, '
            'method = EXCLUDED.method, completeness = EXCLUDED.completeness, session_id = EXCLUDED.session_id, '
            'dedupe_id = EXCLUDED.dedupe_id, received_at = NOW()',
            candle['source'], candle['symbol'], candle['timeframe'], int(candle['epoch']),
            float(candle['open']), float(candle['high']), float(candle['low']), float(candle['close']),
            None if candle.get('volume') is None else float(candle['volume']), close_epoch,
            candle.get('method'), candle.get('completeness'), session_id, dedupe_id,
        ))

    async def mirror_counts(self):
        """Row counts from PostgreSQL for status reporting; falls back to in-memory counters."""
        if self.pool is None:
            return {**self.mirrored, 'rows': None}
        try:
            async with self.pool.acquire() as conn:
                ticks = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM observer_ticks'), timeout=5)
                candles = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM observer_candles'), timeout=5)
            return {**self.mirrored, 'rows': {'observer_ticks': ticks, 'observer_candles': candles}}
        except Exception as exc:  # noqa: BLE001
            return {**self.mirrored, 'rows': None, 'error': type(exc).__name__}

    async def close(self):
        for task in list(self._tasks):
            task.cancel()
        if self.pool is not None:
            await self.pool.close()
            self.pool = None
