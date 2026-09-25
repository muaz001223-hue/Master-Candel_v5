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
        # Deriv mirror: buffered, flushed in batches. Defaults come from the environment and
        # can be overridden at runtime (persisted by the caller in MongoDB).
        self.settings = {
            'derivMirrorEnabled': os.environ.get('POSTGRES_MIRROR_DERIV_ENABLED', 'true').lower() == 'true',
            'tickRetentionDays': int(os.environ.get('POSTGRES_MIRROR_TICK_RETENTION_DAYS', '7') or 7),
            'candleRetentionDays': int(os.environ.get('POSTGRES_MIRROR_CANDLE_RETENTION_DAYS', '30') or 30),
        }
        self.flush_interval = float(os.environ.get('POSTGRES_MIRROR_FLUSH_SECONDS', '5') or 5)
        self.deriv_mirrored = {'ticks': 0, 'candles': 0, 'failed': 0, 'dropped': 0, 'lastFlush': None}
        self._tick_buffer = []
        self._candle_buffer = {}
        self._flush_task = None
        self._cleanup_task = None
        self.last_cleanup = None

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
                    'CREATE TABLE IF NOT EXISTS deriv_ticks ('
                    'id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL, '
                    'price DOUBLE PRECISION NOT NULL, epoch DOUBLE PRECISION NOT NULL, method TEXT, '
                    'received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
                )
                await conn.execute(
                    'CREATE INDEX IF NOT EXISTS deriv_ticks_symbol_epoch ON deriv_ticks (symbol, epoch DESC)'
                )
                await conn.execute(
                    'CREATE INDEX IF NOT EXISTS deriv_ticks_received ON deriv_ticks (received_at)'
                )
                await conn.execute(
                    'CREATE TABLE IF NOT EXISTS deriv_candles ('
                    'source TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, epoch BIGINT NOT NULL, '
                    'open DOUBLE PRECISION NOT NULL, high DOUBLE PRECISION NOT NULL, low DOUBLE PRECISION NOT NULL, '
                    'close DOUBLE PRECISION NOT NULL, method TEXT, completeness TEXT, '
                    'received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), '
                    'PRIMARY KEY (source, symbol, timeframe, epoch))'
                )
                await conn.execute(
                    'CREATE INDEX IF NOT EXISTS deriv_candles_received ON deriv_candles (received_at)'
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
            if self._flush_task is None:
                self._flush_task = asyncio.create_task(self._flush_loop())
            if self._cleanup_task is None:
                self._cleanup_task = asyncio.create_task(self._cleanup_loop())
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
            return {'enabled': True, 'state': 'CONNECTED', 'mirror': {**await self.mirror_counts(), 'deriv': self.mirror_status()['deriv'], 'settings': dict(self.settings)}}
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

    # ----- Deriv mirror (buffered) -------------------------------------------------
    def queue_tick(self, source, symbol, price, epoch, method):
        """Buffer a provider tick; flushed to deriv_ticks every flush_interval seconds."""
        if not self.enabled or not self.settings['derivMirrorEnabled']:
            return
        if len(self._tick_buffer) >= 50000:
            self.deriv_mirrored['dropped'] += 1
            return
        self._tick_buffer.append((source, symbol, float(price), float(epoch), method))
        # Tick-derived buckets are aggregated in memory so every timeframe candle is mirrored too.
        for timeframe, seconds in self._timeframes().items():
            bucket = int(epoch // seconds) * seconds
            key = (source, symbol, timeframe, bucket)
            current = self._candle_buffer.get(key)
            if current is None:
                self._candle_buffer[key] = [float(price), float(price), float(price), float(price), method, 'PARTIAL_TICK_COVERAGE']
            else:
                current[1] = max(current[1], float(price))
                current[2] = min(current[2], float(price))
                current[3] = float(price)

    def queue_candles(self, candles):
        """Buffer provider OHLC candles (e.g. Deriv history); newer values replace older ones."""
        if not self.enabled or not self.settings['derivMirrorEnabled']:
            return
        for candle in candles:
            key = (candle['source'], candle['symbol'], candle['timeframe'], int(candle['epoch']))
            self._candle_buffer[key] = [float(candle['open']), float(candle['high']), float(candle['low']), float(candle['close']), candle.get('method'), candle.get('completeness')]

    @staticmethod
    def _timeframes():
        try:
            from market_config import TIMEFRAMES
            return TIMEFRAMES
        except Exception:  # noqa: BLE001
            return {}

    async def flush(self):
        if self.pool is None or (not self._tick_buffer and not self._candle_buffer):
            return
        ticks, self._tick_buffer = self._tick_buffer, []
        candles, self._candle_buffer = self._candle_buffer, {}
        rows = [(k[0], k[1], k[2], k[3], v[0], v[1], v[2], v[3], v[4], v[5]) for k, v in candles.items()]
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    if ticks:
                        await conn.executemany(
                            'INSERT INTO deriv_ticks (source, symbol, price, epoch, method) VALUES ($1, $2, $3, $4, $5)', ticks)
                    if rows:
                        await conn.executemany(
                            'INSERT INTO deriv_candles (source, symbol, timeframe, epoch, open, high, low, close, method, completeness) '
                            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) '
                            'ON CONFLICT (source, symbol, timeframe, epoch) DO UPDATE SET '
                            'open = CASE WHEN deriv_candles.completeness = \'PROVIDER_OHLC\' AND EXCLUDED.completeness <> \'PROVIDER_OHLC\' THEN deriv_candles.open ELSE EXCLUDED.open END, '
                            'high = GREATEST(deriv_candles.high, EXCLUDED.high), low = LEAST(deriv_candles.low, EXCLUDED.low), '
                            'close = EXCLUDED.close, method = EXCLUDED.method, '
                            'completeness = CASE WHEN deriv_candles.completeness = \'PROVIDER_OHLC\' THEN deriv_candles.completeness ELSE EXCLUDED.completeness END, '
                            'received_at = NOW()', rows)
            self.deriv_mirrored['ticks'] += len(ticks)
            self.deriv_mirrored['candles'] += len(rows)
            self.deriv_mirrored['lastFlush'] = time.time()
        except Exception as exc:  # noqa: BLE001 - never break ingestion; data is retried once
            self.deriv_mirrored['failed'] += 1
            self.error = type(exc).__name__
            logger.warning('PostgreSQL deriv flush failed: %s', exc)
            if len(self._tick_buffer) + len(ticks) <= 50000:
                self._tick_buffer = ticks + self._tick_buffer
            else:
                self.deriv_mirrored['dropped'] += len(ticks)
            for key, value in candles.items():
                self._candle_buffer.setdefault(key, value)

    async def _flush_loop(self):
        while True:
            await asyncio.sleep(self.flush_interval)
            await self.flush()

    async def apply_retention(self):
        """Delete mirrored rows older than the configured retention (all four tables)."""
        if self.pool is None:
            return None
        ticks_days, candles_days = self.settings['tickRetentionDays'], self.settings['candleRetentionDays']
        removed = {}
        try:
            async with self.pool.acquire() as conn:
                for table, days in [('deriv_ticks', ticks_days), ('observer_ticks', ticks_days), ('deriv_candles', candles_days), ('observer_candles', candles_days)]:
                    result = await conn.execute(f"DELETE FROM {table} WHERE received_at < NOW() - ($1 * INTERVAL '1 day')", float(days))
                    removed[table] = int(result.split()[-1]) if result else 0
            self.last_cleanup = time.time()
            return removed
        except Exception as exc:  # noqa: BLE001
            self.error = type(exc).__name__
            logger.warning('PostgreSQL retention cleanup failed: %s', exc)
            return None

    async def _cleanup_loop(self):
        await asyncio.sleep(20)
        while True:
            await self.apply_retention()
            await asyncio.sleep(3600)

    def update_settings(self, **changes):
        for key, value in changes.items():
            if key in self.settings and value is not None:
                self.settings[key] = value
        if not self.settings['derivMirrorEnabled']:
            self._tick_buffer.clear()
            self._candle_buffer.clear()
        return dict(self.settings)

    def mirror_status(self):
        return {
            'state': self.state, 'error': self.error, 'settings': dict(self.settings),
            'flushIntervalSeconds': self.flush_interval, 'lastCleanup': self.last_cleanup,
            'observer': dict(self.mirrored), 'deriv': {**self.deriv_mirrored, 'pendingTicks': len(self._tick_buffer), 'pendingCandles': len(self._candle_buffer)},
        }

    async def analytics(self, days=7):
        """Per-pair and per-day counts across observer and Deriv mirror tables."""
        if self.pool is None:
            return None
        days = max(1, min(int(days), 90))
        pairs, daily = [], {}
        async with self.pool.acquire() as conn:
            for source_label, tick_table, candle_table in [('market-qx-observer-v2', 'observer_ticks', 'observer_candles'), ('deriv', 'deriv_ticks', 'deriv_candles')]:
                rows = await conn.fetch(
                    f"SELECT COALESCE(t.symbol, c.symbol) AS symbol, COALESCE(t.ticks, 0) AS ticks, COALESCE(c.candles, 0) AS candles, t.last_tick, c.last_candle "
                    f"FROM (SELECT symbol, COUNT(*) AS ticks, MAX(epoch) AS last_tick FROM {tick_table} WHERE received_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY symbol) t "
                    f"FULL OUTER JOIN (SELECT symbol, COUNT(*) AS candles, MAX(epoch) AS last_candle FROM {candle_table} WHERE received_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY symbol) c "
                    f"ON t.symbol = c.symbol ORDER BY ticks DESC, candles DESC LIMIT 200", float(days))
                for row in rows:
                    pairs.append({'source': source_label, 'symbol': row['symbol'], 'ticks': int(row['ticks']), 'candles': int(row['candles']), 'lastTick': None if row['last_tick'] is None else float(row['last_tick']), 'lastCandle': None if row['last_candle'] is None else float(row['last_candle'])})
                for kind, table in [('ticks', tick_table), ('candles', candle_table)]:
                    rows = await conn.fetch(
                        f"SELECT (received_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS n FROM {table} WHERE received_at >= NOW() - ($1 * INTERVAL '1 day') GROUP BY day ORDER BY day", float(days))
                    prefix = 'observer' if source_label != 'deriv' else 'deriv'
                    for row in rows:
                        entry = daily.setdefault(row['day'].isoformat(), {'date': row['day'].isoformat(), 'observerTicks': 0, 'observerCandles': 0, 'derivTicks': 0, 'derivCandles': 0})
                        entry[f'{prefix}{kind.capitalize()}'] = int(row['n'])
        totals = {'observerTicks': sum(p['ticks'] for p in pairs if p['source'] != 'deriv'), 'observerCandles': sum(p['candles'] for p in pairs if p['source'] != 'deriv'), 'derivTicks': sum(p['ticks'] for p in pairs if p['source'] == 'deriv'), 'derivCandles': sum(p['candles'] for p in pairs if p['source'] == 'deriv')}
        return {'days': days, 'pairs': pairs, 'daily': [daily[k] for k in sorted(daily)], 'totals': totals, 'mirror': self.mirror_status(), 'generatedAt': time.time()}

    async def mirror_counts(self):
        """Row counts from PostgreSQL for status reporting; falls back to in-memory counters."""
        if self.pool is None:
            return {**self.mirrored, 'rows': None}
        try:
            async with self.pool.acquire() as conn:
                ticks = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM observer_ticks'), timeout=5)
                candles = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM observer_candles'), timeout=5)
                deriv_ticks = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM deriv_ticks'), timeout=5)
                deriv_candles = await asyncio.wait_for(conn.fetchval('SELECT COUNT(*) FROM deriv_candles'), timeout=5)
            return {**self.mirrored, 'rows': {'observer_ticks': ticks, 'observer_candles': candles, 'deriv_ticks': deriv_ticks, 'deriv_candles': deriv_candles}}
        except Exception as exc:  # noqa: BLE001
            return {**self.mirrored, 'rows': None, 'error': type(exc).__name__}

    async def close(self):
        for task in [self._flush_task, self._cleanup_task]:
            if task is not None:
                task.cancel()
        self._flush_task = self._cleanup_task = None
        with_pool = self.pool is not None
        if with_pool:
            try:
                await asyncio.wait_for(self.flush(), timeout=10)
            except Exception:  # noqa: BLE001
                pass
        for task in list(self._tasks):
            task.cancel()
        if self.pool is not None:
            await self.pool.close()
            self.pool = None
