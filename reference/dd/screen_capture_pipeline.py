"""Convert OCR screen prices into explicitly unverified local candle JSON.

This is a screen-capture analytics source, not a verified market-data provider.
It sends only validated locally constructed candles to ws://localhost:8080.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import websockets

LOGGER = logging.getLogger("unverified-screen-capture")
SOURCE = "UNVERIFIED_SCREEN_CAPTURE"
PRICE_PATTERN = re.compile(r"^\d+(?:\.\d+)?$")


@dataclass(frozen=True)
class ScreenCandle:
    asset: str
    timeframe: str
    open: float
    high: float
    low: float
    close: float
    volume: None
    open_timestamp: str
    close_timestamp: str
    source_timestamp: str
    ingestion_timestamp: str
    source: str = SOURCE
    data_quality: str = "UNVERIFIED"
    validation_status: str = "VALIDATED_FOR_LOCAL_TRANSPORT"

    def to_payload(self) -> dict[str, Any]:
        return {
            "event_type": "SCREEN_CAPTURE_CANDLE",
            "source": SOURCE,
            "data_quality": self.data_quality,
            "validation_status": self.validation_status,
            "asset": self.asset,
            "timeframe": self.timeframe,
            "ohlc": {
                "open": self.open,
                "high": self.high,
                "low": self.low,
                "close": self.close,
            },
            "volume": self.volume,
            "open_timestamp": self.open_timestamp,
            "close_timestamp": self.close_timestamp,
            "source_timestamp": self.source_timestamp,
            "ingestion_timestamp": self.ingestion_timestamp,
        }


class CandleBuilder:
    def __init__(self, asset: str, timeframe_seconds: int = 1, max_jump_ratio: float = 0.20) -> None:
        if not asset.strip():
            raise ValueError("asset is required")
        if timeframe_seconds < 1:
            raise ValueError("timeframe_seconds must be positive")
        self.asset = asset
        self.timeframe_seconds = timeframe_seconds
        self.max_jump_ratio = max_jump_ratio
        self._bucket: int | None = None
        self._prices: list[float] = []
        self._last_price: float | None = None
        self._last_source_timestamp: float | None = None

    def add_ocr_price(self, raw_text: str, source_time: float | None = None) -> ScreenCandle | None:
        price = parse_ocr_price(raw_text)
        if price is None:
            return None
        source_time = time.time() if source_time is None else source_time
        if not math.isfinite(source_time) or source_time <= 0:
            return None
        if self._last_source_timestamp is not None and source_time < self._last_source_timestamp:
            return None
        if self._last_price is not None and abs(price - self._last_price) / self._last_price > self.max_jump_ratio:
            LOGGER.warning("dropped abnormal OCR jump: %s -> %s", self._last_price, price)
            return None

        bucket = int(source_time // self.timeframe_seconds) * self.timeframe_seconds
        completed: ScreenCandle | None = None
        if self._bucket is not None and bucket > self._bucket and self._prices:
            completed = self._build(self._bucket, self._prices[-1], source_time)
            self._prices = []
        self._bucket = bucket
        self._prices.append(price)
        self._last_price = price
        self._last_source_timestamp = source_time
        return completed

    def flush(self, now: float | None = None) -> ScreenCandle | None:
        now = time.time() if now is None else now
        if self._bucket is None or not self._prices:
            return None
        if now < self._bucket + self.timeframe_seconds:
            return None
        candle = self._build(self._bucket, self._prices[-1], now)
        self._bucket = None
        self._prices = []
        return candle

    def _build(self, bucket: int, last_source_price: float, now: float) -> ScreenCandle | None:
        values = list(self._prices)
        if not values or not validate_ohlc(values[0], max(values), min(values), last_source_price):
            return None
        open_time = datetime.fromtimestamp(bucket, timezone.utc).isoformat()
        close_time = datetime.fromtimestamp(bucket + self.timeframe_seconds, timezone.utc).isoformat()
        ingestion_time = datetime.fromtimestamp(now, timezone.utc).isoformat()
        return ScreenCandle(
            asset=self.asset,
            timeframe=f"{self.timeframe_seconds}s",
            open=values[0],
            high=max(values),
            low=min(values),
            close=last_source_price,
            volume=None,
            open_timestamp=open_time,
            close_timestamp=close_time,
            source_timestamp=ingestion_time,
            ingestion_timestamp=ingestion_time,
        )


def parse_ocr_price(raw_text: str) -> float | None:
    """Parse conservatively; ambiguous OCR values are dropped, never guessed."""
    if not isinstance(raw_text, str):
        return None
    value = raw_text.strip().replace(",", "").replace(" ", "")
    if not PRICE_PATTERN.fullmatch(value):
        return None
    try:
        price = float(value)
    except ValueError:
        return None
    return price if math.isfinite(price) and price > 0 else None


def validate_ohlc(open_price: float, high: float, low: float, close: float) -> bool:
    values = (open_price, high, low, close)
    return all(math.isfinite(value) and value > 0 for value in values) and high >= max(open_price, close) and low <= min(open_price, close) and low <= high


class LocalCandleSender:
    def __init__(self, uri: str = "ws://localhost:8080", queue_size: int = 256) -> None:
        self.uri = uri
        self.queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=queue_size)
        self._stop = asyncio.Event()

    async def publish(self, candle: ScreenCandle) -> None:
        payload = json.dumps(candle.to_payload(), separators=(",", ":"), ensure_ascii=False)
        try:
            self.queue.put_nowait(payload)
        except asyncio.QueueFull:
            LOGGER.warning("dropped candle because local WebSocket queue is full")

    async def run(self) -> None:
        delay = 0.5
        while not self._stop.is_set():
            try:
                async with websockets.connect(self.uri, ping_interval=20, ping_timeout=20, max_size=1_048_576) as socket:
                    LOGGER.info("connected to local pipeline: %s", self.uri)
                    delay = 0.5
                    while not self._stop.is_set():
                        payload = await self.queue.get()
                        if payload is None:
                            return
                        await socket.send(payload)
            except (OSError, websockets.WebSocketException) as error:
                LOGGER.warning("local WebSocket unavailable: %s; retrying in %.1fs", error, delay)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    delay = min(delay * 2, 10.0)

    async def close(self) -> None:
        self._stop.set()
        try:
            self.queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


async def run_ocr_pipeline(asset: str, read_price: Any, timeframe_seconds: int = 1) -> None:
    """Connect an existing OCR callback: ``read_price() -> str | None``."""
    sender = LocalCandleSender()
    builder = CandleBuilder(asset, timeframe_seconds)
    sender_task = asyncio.create_task(sender.run())
    try:
        while True:
            raw_price = read_price()
            if raw_price is not None:
                candle = builder.add_ocr_price(raw_price)
                if candle is not None:
                    await sender.publish(candle)
            await asyncio.sleep(0.05)
    finally:
        final = builder.flush()
        if final is not None:
            await sender.publish(final)
        await sender.close()
        await sender_task
