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
            return {'enabled': True, 'state': 'CONNECTED'}
        except Exception as exc:  # noqa: BLE001
            self.state = 'UNAVAILABLE'
            self.error = type(exc).__name__
            return {'enabled': True, 'state': 'UNAVAILABLE', 'error': self.error}

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None
