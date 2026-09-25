"""Service-only ingestion authentication. No user/broker login or cookies."""
import hashlib
import hmac
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from market_config import INGEST_HASH

header = APIKeyHeader(name='X-Market-QX-Key', auto_error=False)


async def require_observer_key(key: str | None = Security(header)):
    if not key or not hmac.compare_digest(hashlib.sha256(key.encode()).hexdigest(), INGEST_HASH):
        raise HTTPException(401, 'Invalid ingestion key')