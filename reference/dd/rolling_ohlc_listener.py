import asyncio
import json
import logging
from collections import deque
from datetime import datetime

import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rolling_ohlc_listener")

URI = "ws://localhost:8080"
WINDOW = deque(maxlen=20)


def format_row(item: dict) -> str:
    ts = item.get("timestamp", "")
    open_val = item.get("open")
    high_val = item.get("high")
    low_val = item.get("low")
    close_val = item.get("close")
    status = "OK" if item.get("source") == "UNVERIFIED_SCREEN_CAPTURE" else "CHECK"
    return f"{ts} | {open_val} | {high_val} | {low_val} | {close_val} | {status}"


async def listen() -> None:
    logger.info("connecting to %s", URI)
    while True:
        try:
            async with websockets.connect(URI, ping_interval=20, ping_timeout=20) as websocket:
                logger.info("connected")
                while True:
                    raw = await websocket.recv()
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError:
                        logger.warning("non-JSON frame: %s", raw[:200])
                        continue
                    timeframe = payload.get("timeframe")
                    if timeframe not in {"1m", "1s"}:
                        continue
                    if payload.get("source") != "UNVERIFIED_SCREEN_CAPTURE":
                        continue
                    if payload.get("timeframe") == "1m":
                        WINDOW.append(payload)
                        print("\nTime | Open | High | Low | Close | Status")
                        print("-" * 72)
                        for item in list(WINDOW):
                            print(format_row(item))
        except Exception as exc:
            logger.warning("listener reconnecting after error: %s", exc)
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(listen())
