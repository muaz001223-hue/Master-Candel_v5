import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient


def _read_env_value(key: str, env_path: str | None = None) -> str | None:
    value = os.environ.get(key)
    if value:
        return value.strip()
    if env_path:
        env = dotenv_values(env_path)
        file_value = env.get(key)
        if file_value:
            return str(file_value).strip()
    return None


@pytest.fixture(scope="session")
def base_url() -> str:
    url = _read_env_value("REACT_APP_BACKEND_URL", "/app/frontend/.env")
    if not url:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    return url.rstrip("/")


@pytest.fixture(scope="session")
def observer_key() -> str:
    key = _read_env_value("OBSERVER_SERVICE_KEY", "/app/backend/.env")
    if key:
        return key

    credentials_path = Path("/app/memory/test_credentials.md")
    if credentials_path.exists():
        text = credentials_path.read_text(encoding="utf-8")
        match = re.search(r"Current service key:\s*`([^`]+)`", text)
        if match:
            return match.group(1).strip()
    pytest.skip("OBSERVER_SERVICE_KEY missing")


@pytest.fixture(scope="session")
def api_client() -> requests.Session:
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="session")
def mongo_db():
    mongo_url = _read_env_value("MONGO_URL", "/app/backend/.env")
    db_name = _read_env_value("DB_NAME", "/app/backend/.env")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL or DB_NAME missing")
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        db = client[db_name]
        db.command("ping")
        yield db
    finally:
        client.close()


def _cleanup_testonly_data(db) -> None:
    observer_source = "market-qx-observer-v2"
    test_session_filter = {"$regex": r"^TESTONLY-session-"}

    db.market_instruments.delete_many(
        {
            "$or": [
                {"symbol": {"$regex": r"^TESTONLY"}},
                {"source": observer_source, "session_id": test_session_filter},
            ]
        }
    )
    db.market_ticks.delete_many({"symbol": {"$regex": r"^TESTONLY"}})
    db.market_candles.delete_many({"symbol": {"$regex": r"^TESTONLY"}})
    db.observer_receipts.delete_many({"session_id": test_session_filter})
    db.observer_status.delete_many({"session_id": test_session_filter})


@pytest.fixture(scope="session", autouse=True)
def session_cleanup_testonly_records(mongo_db):
    """Clean fixture-created TESTONLY/session records before and after full test session."""
    _cleanup_testonly_data(mongo_db)
    yield
    _cleanup_testonly_data(mongo_db)
