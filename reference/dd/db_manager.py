from __future__ import annotations

import os
import queue
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "market_data.db")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class DatabaseManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._queue: queue.Queue[tuple[str, tuple[Any, ...], dict[str, Any]]] = queue.Queue()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._worker, name="sqlite-writer", daemon=True)
        self._thread.start()
        self.initialize()

    def initialize(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS candles_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    open_price REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    volume REAL DEFAULT 0,
                    anomaly_status TEXT DEFAULT 'CLEAN'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    consensus_ratio REAL,
                    outcome TEXT NOT NULL DEFAULT 'PENDING'
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_candles_history_timestamp ON candles_history(timestamp)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_agent_signals_timestamp ON agent_signals(timestamp)"
            )
            conn.commit()

    def _worker(self) -> None:
        while not self._stop_event.is_set():
            try:
                action, values, kwargs = self._queue.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                if action == "insert_candle":
                    self._insert_candle(**kwargs)
                elif action == "insert_signal":
                    self._insert_signal(**kwargs)
                elif action == "record_outcome":
                    self._record_outcome(**kwargs)
            finally:
                self._queue.task_done()

    def _insert_candle(
        self,
        *,
        timestamp: str,
        asset: str,
        timeframe: str,
        open_price: float,
        high: float,
        low: float,
        close: float,
        volume: float,
        anomaly_status: str,
    ) -> None:
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute(
                """
                INSERT INTO candles_history (
                    timestamp, asset, timeframe, open_price, high, low, close, volume, anomaly_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (timestamp, asset, timeframe, float(open_price), float(high), float(low), float(close), float(volume), anomaly_status),
            )
            conn.commit()

    def _insert_signal(
        self,
        *,
        timestamp: str,
        asset: str,
        action: str,
        timeframe: str,
        consensus_ratio: float,
        outcome: str,
    ) -> None:
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute(
                """
                INSERT INTO agent_signals (timestamp, asset, action, timeframe, consensus_ratio, outcome)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (timestamp, asset, action.upper(), timeframe, float(consensus_ratio), outcome.upper()),
            )
            conn.commit()

    def _record_outcome(self, *, asset: str, timeframe: str, action: str, outcome: str, timestamp: str | None = None) -> None:
        if timestamp is None:
            timestamp = utc_now_iso()
        with sqlite3.connect(self.db_path, timeout=30) as conn:
            conn.execute(
                """
                UPDATE agent_signals
                SET outcome = ?
                WHERE asset = ? AND timeframe = ? AND action = ? AND timestamp = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (outcome.upper(), asset, timeframe, action.upper(), timestamp),
            )
            conn.commit()

    def enqueue_candle(
        self,
        *,
        asset: str,
        timeframe: str,
        open_price: float,
        high: float,
        low: float,
        close: float,
        volume: float = 0.0,
        anomaly_status: str = "CLEAN",
        timestamp: str | None = None,
    ) -> None:
        self._queue.put(
            (
                "insert_candle",
                (),
                {
                    "timestamp": timestamp or utc_now_iso(),
                    "asset": asset,
                    "timeframe": timeframe,
                    "open_price": float(open_price),
                    "high": float(high),
                    "low": float(low),
                    "close": float(close),
                    "volume": float(volume),
                    "anomaly_status": anomaly_status.upper(),
                },
            )
        )

    def enqueue_signal(
        self,
        *,
        asset: str,
        action: str,
        timeframe: str,
        consensus_ratio: float,
        outcome: str = "PENDING",
        timestamp: str | None = None,
    ) -> None:
        self._queue.put(
            (
                "insert_signal",
                (),
                {
                    "timestamp": timestamp or utc_now_iso(),
                    "asset": asset,
                    "action": action,
                    "timeframe": timeframe,
                    "consensus_ratio": float(consensus_ratio),
                    "outcome": outcome.upper(),
                },
            )
        )

    def record_outcome(
        self,
        *,
        asset: str,
        action: str,
        timeframe: str,
        outcome: str,
        timestamp: str | None = None,
    ) -> None:
        self._queue.put(
            (
                "record_outcome",
                (),
                {
                    "timestamp": timestamp or utc_now_iso(),
                    "asset": asset,
                    "action": action,
                    "timeframe": timeframe,
                    "outcome": outcome.upper(),
                },
            )
        )

    def close(self) -> None:
        self._stop_event.set()
        self._queue.put(("stop", (), {}))
        self._thread.join(timeout=3)


DATABASE_MANAGER = DatabaseManager()


def initialize_database() -> None:
    DATABASE_MANAGER.initialize()


def insert_candle(
    *,
    asset: str,
    timeframe: str,
    open_price: float,
    high: float,
    low: float,
    close: float,
    volume: float = 0.0,
    anomaly_status: str = "CLEAN",
    timestamp: str | None = None,
) -> None:
    DATABASE_MANAGER.enqueue_candle(
        asset=asset,
        timeframe=timeframe,
        open_price=open_price,
        high=high,
        low=low,
        close=close,
        volume=volume,
        anomaly_status=anomaly_status,
        timestamp=timestamp,
    )


def insert_agent_signal(
    *,
    asset: str,
    action: str,
    timeframe: str,
    consensus_ratio: float,
    outcome: str = "PENDING",
    timestamp: str | None = None,
) -> None:
    DATABASE_MANAGER.enqueue_signal(
        asset=asset,
        action=action,
        timeframe=timeframe,
        consensus_ratio=consensus_ratio,
        outcome=outcome,
        timestamp=timestamp,
    )


def record_outcome(
    *,
    asset: str,
    action: str,
    timeframe: str,
    outcome: str,
    timestamp: str | None = None,
) -> None:
    DATABASE_MANAGER.record_outcome(
        asset=asset,
        action=action,
        timeframe=timeframe,
        outcome=outcome,
        timestamp=timestamp,
    )


def fetch_history(limit: int = 50) -> list[dict[str, Any]]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT timestamp, asset, timeframe, open_price, high, low, close, volume, anomaly_status
            FROM candles_history
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "timestamp": row[0],
            "asset": row[1],
            "timeframe": row[2],
            "open": row[3],
            "high": row[4],
            "low": row[5],
            "close": row[6],
            "volume": row[7],
            "anomaly_status": row[8],
        }
        for row in rows
    ]


def fetch_signals(limit: int = 100) -> list[dict[str, Any]]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT timestamp, asset, action, timeframe, consensus_ratio, outcome
            FROM agent_signals
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "timestamp": row[0],
            "asset": row[1],
            "action": row[2],
            "timeframe": row[3],
            "consensus_ratio": row[4],
            "outcome": row[5],
        }
        for row in rows
    ]
