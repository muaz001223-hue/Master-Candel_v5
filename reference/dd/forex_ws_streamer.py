"""Subscribe to Finnhub websocket pricing and forward aggregated forex candles to the local relay."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import websockets

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

LOCAL_WS_URL = "ws://127.0.0.1:8080"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def utc_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def relay_to_local(payload: dict[str, Any]) -> None:
    try:
        async with websockets.connect(LOCAL_WS_URL, ping_interval=20, ping_timeout=20) as ws:
            await ws.send(json.dumps({"type": "market", "payload": payload}, separators=(",", ":")))
    except Exception:
        pass


async def main() -> None:
    env = load_env(ROOT_DIR / ".env")
    token = env.get("FINNHUB_API_KEY") or os.getenv("FINNHUB_API_KEY")
    if not token:
        print("FINNHUB_API_KEY missing; forex stream disabled.")
        return

    symbols = ["OANDA:EUR_USD", "OANDA:USD_JPY", "OANDA:GBP_USD", "OANDA:EUR_GBP"]
    aggregates: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)

    async def on_trade(message: dict[str, Any]) -> None:
        data = message.get("data") or []
        if not isinstance(data, list):
            return
        for item in data:
            symbol = item.get("s")
            price = item.get("p")
            ts_ms = item.get("t")
            if not symbol or not isinstance(price, (int, float)) or not ts_ms:
                continue

            key = f"{symbol}|1s"
            bucket = aggregates[symbol].get(key)
            ts = int(ts_ms)
            ts_bucket = ts - (ts % 1000)
            if bucket is None or bucket["bucket_start"] != ts_bucket:
                if bucket is not None:
                    payload = {
                        "asset": symbol.replace(":", "/").replace("OANDA/", "").replace("BINANCE/", ""),
                        "timeframe": "1s",
                        "open": bucket["open"],
                        "high": bucket["high"],
                        "low": bucket["low"],
                        "close": bucket["close"],
                        "volume": bucket["volume"],
                        "timestamp": bucket["timestamp"],
                        "source": "finnhub",
                        "anomaly_status": "CLEAN",
                    }
                    await relay_to_local(payload)
                bucket = {
                    "bucket_start": ts_bucket,
                    "open": float(price),
                    "high": float(price),
                    "low": float(price),
                    "close": float(price),
                    "volume": 1,
                    "timestamp": utc_ts(),
                }
                aggregates[symbol][key] = bucket
            else:
                bucket["high"] = max(bucket["high"], float(price))
                bucket["low"] = min(bucket["low"], float(price))
                bucket["close"] = float(price)
                bucket["volume"] += 1
                bucket["timestamp"] = utc_ts()

    uri = f"wss://ws.finnhub.io?token={token}"
    async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
        for symbol in symbols:
            await ws.send(json.dumps({"type": "subscribe", "symbol": symbol}))
        async for raw in ws:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "trade":
                await on_trade(message)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Finnhub forex streamer stopped.")
