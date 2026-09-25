"""Idempotent local setup; preserve existing values and never print secrets."""
import hashlib
import secrets
import sys
from pathlib import Path
from dotenv import dotenv_values, set_key

ROOT = Path(__file__).resolve().parents[1]


def append_missing(path, settings):
    existing = dotenv_values(path)
    empty = {key: value for key, value in settings.items() if key in existing and not existing[key]}
    for key, value in empty.items():
        set_key(path, key, value)
    additions = {key: value for key, value in settings.items() if key not in existing}
    if additions:
        with path.open('a') as handle:
            handle.write('\n' + '\n'.join(f'{key}="{value}"' for key, value in additions.items()) + '\n')
    return len(additions) + len(empty)


def main():
    frontend = dotenv_values(ROOT / 'frontend/.env')
    backend = dotenv_values(ROOT / 'backend/.env')
    public_url = frontend['REACT_APP_BACKEND_URL'].rstrip('/')
    assert backend['MONGO_URL'] and backend['DB_NAME']
    key = backend.get('OBSERVER_SERVICE_KEY') or secrets.token_urlsafe(48)
    if '--rotate-observer' in sys.argv:
        key = secrets.token_urlsafe(48)
        set_key(ROOT / 'backend/.env', 'OBSERVER_SERVICE_KEY', key)
        set_key(ROOT / 'backend/.env', 'INGESTION_KEY_SHA256', hashlib.sha256(key.encode()).hexdigest())
    settings = {
        'PUBLIC_APP_URL': public_url,
        'DERIV_WS_URL': 'wss://api.derivws.com/trading/v1/options/ws/public',
        'DERIV_ENABLED': 'true',
        'DERIV_SYMBOLS': 'frxEURUSD,frxGBPUSD,frxUSDJPY,frxAUDUSD,frxUSDCAD,frxUSDCHF,frxEURJPY,frxEURGBP,frxGBPJPY,frxAUDJPY,frxEURCHF,frxEURAUD,frxEURCAD,frxEURNZD,frxGBPAUD,frxGBPCAD,frxGBPCHF,frxGBPNZD,frxAUDCAD,frxAUDCHF,frxAUDNZD,frxCADCHF,frxCADJPY,frxCHFJPY,frxNZDUSD,frxNZDJPY,frxNZDCAD,frxNZDCHF,R_10,R_25,R_50,R_75,R_100',
        'MARKET_TIMEFRAMES': '1s,5s,15s,1m,5m',
        'MARKET_FRESHNESS_SECONDS': '30',
        'ANALYSIS_INTERVAL_SECONDS': '15',
        'OBSERVER_SERVICE_KEY': key,
        'INGESTION_KEY_SHA256': hashlib.sha256(key.encode()).hexdigest(),
    }
    count = append_missing(ROOT / 'backend/.env', settings)
    count += append_missing(ROOT / 'frontend/.env', {'DEV_PORT': '3000'})
    print(f'Runtime configured: {count} missing settings added. Existing values preserved; no secrets printed.')


if __name__ == '__main__':
    main()