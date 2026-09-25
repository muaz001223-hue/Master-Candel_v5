"""Local-only WebSocket frame logger for applications you own or control."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection

HOST = "127.0.0.1"
PORT = 8080

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("local-ws-debugger")


def parse_engine_payload(payload: Any) -> dict[str, Any]:
    result = {"raw": payload, "engine_io_type": None, "socket_io": None}
    if not isinstance(payload, str) or not payload:
        return result

    result["engine_io_type"] = payload[0]
    body = payload[1:]
    if payload[0] in {"4", "42"}:
        candidate = body[1:] if payload.startswith("42") else body
        try:
            result["socket_io"] = json.loads(candidate)
        except json.JSONDecodeError:
            result["socket_io"] = None
    return result


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def handle(connection: ServerConnection) -> None:
    peer = connection.remote_address
    LOGGER.info("client connected: %s", peer)
    try:
        async for message in connection:
            received = json.loads(message) if isinstance(message, str) else {"binary": True}
            payload = received.get("payload") if isinstance(received, dict) else received
            parsed = parse_engine_payload(payload.get("text") if isinstance(payload, dict) else payload)
            LOGGER.info("frame=%s", json.dumps({"received_at": timestamp(), "frame": received, "parsed": parsed}, ensure_ascii=False))
    except websockets.ConnectionClosed:
        LOGGER.info("client disconnected: %s", peer)
    except json.JSONDecodeError:
        LOGGER.warning("ignored non-JSON relay message from %s", peer)
    except Exception:
        LOGGER.exception("client handler failed: %s", peer)


async def main() -> None:
    async with websockets.serve(handle, HOST, PORT, max_size=2**20, ping_interval=20, ping_timeout=20):
        LOGGER.info("local WebSocket debugger listening on ws://%s:%d", HOST, PORT)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        LOGGER.info("server stopped")
