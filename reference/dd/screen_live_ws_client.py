import asyncio
import json
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import cv2
import easyocr
import numpy as np
import pyautogui
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("screen_live_ws_client")

PRICE_PATTERN = re.compile(r"^\d+(?:[.,]\d+)?$")


@dataclass
class Candle:
    open: float
    high: float
    low: float
    close: float
    timestamp: str
    source: str = "UNVERIFIED_SCREEN_CAPTURE"
    timeframe: str = "1s"

    def to_payload(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "timeframe": self.timeframe,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "timestamp": self.timestamp,
        }


@dataclass
class MinuteCandle:
    open: float
    high: float
    low: float
    close: float
    timestamp: str
    source: str = "UNVERIFIED_SCREEN_CAPTURE"
    timeframe: str = "1m"

    def to_payload(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "timeframe": self.timeframe,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "timestamp": self.timestamp,
        }


def parse_ocr_value(raw: str) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "").replace(" ", "")
    if not PRICE_PATTERN.fullmatch(text):
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return value


class ScreenCandleBuffer:
    def __init__(self, roi: tuple[int, int, int, int], timeframe_seconds: int = 1, max_jump_ratio: float = 0.12):
        self.roi = roi
        self.timeframe_seconds = timeframe_seconds
        self.max_jump_ratio = max_jump_ratio
        self._bucket_start: float | None = None
        self._values: list[float] = []
        self._last_close: float | None = None
        self._last_ts: float | None = None
        self._minute_values: list[float] = []
        self._minute_start: float | None = None

    def _capture_frame(self) -> np.ndarray | None:
        try:
            img = pyautogui.screenshot(region=self.roi)
            array = np.array(img)
            return cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
        except Exception as exc:
            logger.warning("screen capture failed: %s", exc)
            return None

    def _detect_resolution_shift(self) -> bool:
        try:
            width, height = pyautogui.size()
            return width <= 0 or height <= 0
        except Exception:
            return True

    def read_current_price(self, reader: easyocr.Reader) -> float | None:
        if self._detect_resolution_shift():
            logger.warning("screen resolution change detected; waiting for ROI recalibration")
            return None
        frame = self._capture_frame()
        if frame is None:
            return None
        try:
            result = reader.readtext(frame, detail=0, allowlist="0123456789.,")
        except Exception:
            return None
        if not result:
            return None
        text = "".join(str(item).strip() for item in result if str(item).strip())
        value = parse_ocr_value(text)
        if value is None:
            return None
        return value

    def ingest(self, price: float, now_ts: float | None = None) -> tuple[Candle | None, MinuteCandle | None]:
        if not math.isfinite(price) or price <= 0:
            return None, None
        now_ts = time.time() if now_ts is None else now_ts
        if self._last_ts is not None and now_ts < self._last_ts:
            return None, None
        if self._last_close is not None:
            ratio = abs(price - self._last_close) / self._last_close
            if ratio > self.max_jump_ratio:
                logger.warning("dropped abnormal OCR jump: %.6f -> %.6f (ratio %.4f)", self._last_close, price, ratio)
                return None, None

        bucket = int(now_ts // self.timeframe_seconds) * self.timeframe_seconds
        if self._bucket_start is None:
            self._bucket_start = bucket
            self._values = [price]
            self._last_close = price
            self._last_ts = now_ts
        else:
            if bucket > self._bucket_start:
                candle = Candle(
                    open=self._values[0],
                    high=max(self._values),
                    low=min(self._values),
                    close=self._values[-1],
                    timestamp=datetime.fromtimestamp(self._bucket_start, tz=timezone.utc).isoformat(),
                    timeframe="1s",
                )
                self._bucket_start = bucket
                self._values = [price]
                self._last_close = price
                self._last_ts = now_ts
                minute_candle = self._aggregate_minute(candle.close, now_ts)
                return candle, minute_candle
            self._values.append(price)
            self._last_close = price
            self._last_ts = now_ts

        minute_candle = self._aggregate_minute(price, now_ts)
        return None, minute_candle

    def _aggregate_minute(self, last_price: float, now_ts: float) -> MinuteCandle | None:
        if self._minute_start is None:
            self._minute_start = int(now_ts // 60) * 60
            self._minute_values = [last_price]
            return None

        minute_bucket = int(now_ts // 60) * 60
        if minute_bucket > self._minute_start:
            if not self._minute_values:
                return None
            minute = MinuteCandle(
                open=self._minute_values[0],
                high=max(self._minute_values),
                low=min(self._minute_values),
                close=self._minute_values[-1],
                timestamp=datetime.fromtimestamp(self._minute_start, tz=timezone.utc).isoformat(),
            )
            self._minute_start = minute_bucket
            self._minute_values = [last_price]
            return minute

        self._minute_values.append(last_price)
        return None


class WebSocketSender:
    def __init__(self, uri: str = "ws://localhost:8080", reconnect_delay: float = 1.0) -> None:
        self.uri = uri
        self.reconnect_delay = reconnect_delay

    async def send(self, payload: dict[str, Any]) -> None:
        backoff = self.reconnect_delay
        while True:
            try:
                async with websockets.connect(self.uri, ping_interval=20, ping_timeout=20) as websocket:
                    await websocket.send(json.dumps(payload, separators=(",", ":")))
                    logger.info("sent payload: %s", payload)
                    return
            except Exception as exc:
                logger.warning("WebSocket send failed: %s; reconnecting in %.1fs", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15.0)


async def run_pipeline(roi: tuple[int, int, int, int], device_name: str = "EUR/USD", ws_uri: str = "ws://localhost:8080") -> None:
    reader = easyocr.Reader(["en"], gpu=False)
    buffer = ScreenCandleBuffer(roi=roi)
    sender = WebSocketSender(uri=ws_uri)
    last_minute_payload: dict[str, Any] | None = None

    try:
        while True:
            price = buffer.read_current_price(reader)
            if price is None:
                await asyncio.sleep(0.25)
                continue
            candle, minute_candle = buffer.ingest(price)
            if candle is not None:
                payload = {
                    "asset": device_name,
                    "source": "UNVERIFIED_SCREEN_CAPTURE",
                    "timeframe": candle.timeframe,
                    "open": candle.open,
                    "high": candle.high,
                    "low": candle.low,
                    "close": candle.close,
                    "timestamp": candle.timestamp,
                }
                await sender.send(payload)
            if minute_candle is not None:
                last_minute_payload = {
                    "asset": device_name,
                    "source": "UNVERIFIED_SCREEN_CAPTURE",
                    "timeframe": minute_candle.timeframe,
                    "open": minute_candle.open,
                    "high": minute_candle.high,
                    "low": minute_candle.low,
                    "close": minute_candle.close,
                    "timestamp": minute_candle.timestamp,
                }
                await sender.send(last_minute_payload)
            await asyncio.sleep(0.25)
    except KeyboardInterrupt:
        logger.info("stopped by user")


if __name__ == "__main__":
    my_roi = (1350, 285, 80, 30)
    asyncio.run(run_pipeline(my_roi, device_name="EUR/USD"))
