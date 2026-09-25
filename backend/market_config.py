"""All runtime connection configuration comes from the backend environment."""
import os

DERIV_URL = os.environ['DERIV_WS_URL']
DERIV_ENABLED = os.environ['DERIV_ENABLED'].lower() == 'true'
DERIV_SYMBOLS = [s.strip() for s in os.environ['DERIV_SYMBOLS'].split(',') if s.strip()]
TIMEFRAMES = {v: int(v[:-1]) * (60 if v[-1] == 'm' else 1) for v in os.environ['MARKET_TIMEFRAMES'].split(',')}
FRESHNESS = int(os.environ['MARKET_FRESHNESS_SECONDS'])
INGEST_HASH = os.environ['INGESTION_KEY_SHA256']
PUBLIC_URL = os.environ['PUBLIC_APP_URL']
ORIGINS = [PUBLIC_URL if v.strip() == '*' else v.strip() for v in os.environ['CORS_ORIGINS'].split(',') if v.strip()]
ANALYSIS_INTERVAL = int(os.environ['ANALYSIS_INTERVAL_SECONDS'])