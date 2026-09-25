#!/usr/bin/env python3
"""
Backend Regression + New Feature Testing for Master Candle FastAPI App
Tests all backend endpoints as specified in the review request.
Focus: PostgreSQL mirror feature with observer tick/candle ingestion.
"""

import requests
import json
import time
from datetime import datetime, timezone, timedelta
from uuid import uuid4
import zipfile
from io import BytesIO

# Read backend URL from frontend/.env
with open('/app/frontend/.env', 'r') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL='):
            BACKEND_URL = line.split('=', 1)[1].strip()
            break

# Read observer service key from backend/.env
with open('/app/backend/.env', 'r') as f:
    for line in f:
        if line.startswith('OBSERVER_SERVICE_KEY='):
            OBSERVER_KEY = line.split('=', 1)[1].strip().strip('"')
            break

print(f"Testing backend at: {BACKEND_URL}")
print(f"Observer key: {OBSERVER_KEY[:20]}...")
print("=" * 80)

# Test results tracking
test_results = []
failed_tests = []

def test(name, func):
    """Run a test and track results"""
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print(f"{'='*80}")
    try:
        result = func()
        test_results.append((name, "PASS"))
        print(f"✅ PASS: {name}")
        return result
    except AssertionError as e:
        test_results.append((name, "FAIL"))
        failed_tests.append((name, str(e)))
        print(f"❌ FAIL: {name}")
        print(f"   Error: {e}")
        return None
    except Exception as e:
        test_results.append((name, "ERROR"))
        failed_tests.append((name, f"Exception: {e}"))
        print(f"❌ ERROR: {name}")
        print(f"   Exception: {e}")
        return None

# ============================================================================
# NEW FEATURE TEST 1: Health Endpoint with postgres.mirror
# ============================================================================
def test_health_postgres_mirror():
    """GET /api/health → postgres.state == "CONNECTED" and postgres.mirror object present"""
    response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    
    postgres = data.get('postgres', {})
    assert postgres.get('state') == 'CONNECTED', f"Expected postgres.state='CONNECTED', got {postgres.get('state')}"
    
    mirror = postgres.get('mirror', {})
    assert mirror is not None, "Expected postgres.mirror object to be present"
    assert 'ticks' in mirror, "Expected postgres.mirror.ticks to be present"
    assert 'candles' in mirror, "Expected postgres.mirror.candles to be present"
    assert 'failed' in mirror, "Expected postgres.mirror.failed to be present"
    assert 'rows' in mirror, "Expected postgres.mirror.rows to be present"
    
    rows = mirror.get('rows', {})
    assert 'observer_ticks' in rows, "Expected postgres.mirror.rows.observer_ticks to be present"
    assert 'observer_candles' in rows, "Expected postgres.mirror.rows.observer_candles to be present"
    
    print(f"✓ Mirror counts before: ticks={rows['observer_ticks']}, candles={rows['observer_candles']}")
    
    return {
        'ticks_before': rows['observer_ticks'],
        'candles_before': rows['observer_candles']
    }

initial_counts = test("1. Health Endpoint with postgres.mirror", test_health_postgres_mirror)

# ============================================================================
# NEW FEATURE TEST 2: POST /api/v1/observation/pairs
# ============================================================================
def test_observation_pairs_new_format():
    """POST /api/v1/observation/pairs with schema_version 2 and GBP/USD (OTC)"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY, 'Content-Type': 'application/json'}
    session_id = f"test-session-{uuid4()}"
    body = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": session_id,
        "dedupe_id": f"pairs-{uuid4()}",
        "observationMethod": "visible-dom-only",
        "pairs": [
            {
                "symbol": "GBP/USD (OTC)",
                "providerSymbol": "GBP/USD (OTC)",
                "timeframe": "1m"
            }
        ]
    }
    
    response = requests.post(f"{BACKEND_URL}/api/v1/observation/pairs", 
                            headers=headers, json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Request body: {json.dumps(body, indent=2)}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text}"
    data = response.json()
    assert data.get('ok') == True, f"Expected ok=true, got {data.get('ok')}"
    
    return session_id

session_id = test("2. POST /api/v1/observation/pairs (GBP/USD OTC)", test_observation_pairs_new_format)

# ============================================================================
# NEW FEATURE TEST 3: POST /api/v1/observation/tick with timestamps
# ============================================================================
def test_observation_tick_with_timestamps():
    """POST /api/v1/observation/tick twice with strictly increasing timestamps"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY, 'Content-Type': 'application/json'}
    
    # First tick with current timestamp
    now = datetime.now(timezone.utc)
    dedupe_id_1 = f"tick-{uuid4()}"
    body_1 = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": session_id or f"test-session-{uuid4()}",
        "dedupe_id": dedupe_id_1,
        "observationMethod": "visible-dom-only",
        "symbol": "GBP/USD (OTC)",
        "providerSymbol": "GBP/USD (OTC)",
        "price": 1.2701,
        "timeframe": "tick",
        "timestamp": now.isoformat().replace('+00:00', 'Z')
    }
    
    print(f"First tick timestamp: {body_1['timestamp']}")
    response_1 = requests.post(f"{BACKEND_URL}/api/v1/observation/tick", 
                              headers=headers, json=body_1, timeout=10)
    print(f"Status: {response_1.status_code}")
    print(f"Response: {json.dumps(response_1.json(), indent=2)}")
    
    assert response_1.status_code == 200, f"Expected 200, got {response_1.status_code}"
    data_1 = response_1.json()
    assert data_1.get('ok') == True, f"Expected ok=true, got {data_1.get('ok')}"
    assert data_1.get('duplicate') == False, f"Expected duplicate=false for first tick, got {data_1.get('duplicate')}"
    
    # Second tick with later timestamp
    time.sleep(0.5)
    now_2 = datetime.now(timezone.utc)
    dedupe_id_2 = f"tick-{uuid4()}"
    body_2 = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": session_id or f"test-session-{uuid4()}",
        "dedupe_id": dedupe_id_2,
        "observationMethod": "visible-dom-only",
        "symbol": "GBP/USD (OTC)",
        "providerSymbol": "GBP/USD (OTC)",
        "price": 1.2702,
        "timeframe": "tick",
        "timestamp": now_2.isoformat().replace('+00:00', 'Z')
    }
    
    print(f"\nSecond tick timestamp: {body_2['timestamp']}")
    response_2 = requests.post(f"{BACKEND_URL}/api/v1/observation/tick", 
                              headers=headers, json=body_2, timeout=10)
    print(f"Status: {response_2.status_code}")
    print(f"Response: {json.dumps(response_2.json(), indent=2)}")
    
    assert response_2.status_code == 200, f"Expected 200, got {response_2.status_code}"
    data_2 = response_2.json()
    assert data_2.get('ok') == True, f"Expected ok=true, got {data_2.get('ok')}"
    assert data_2.get('duplicate') == False, f"Expected duplicate=false for second tick, got {data_2.get('duplicate')}"
    
    # Post the first one again (same dedupe_id) → should return duplicate=true
    print(f"\nRetrying first tick with same dedupe_id: {dedupe_id_1}")
    response_3 = requests.post(f"{BACKEND_URL}/api/v1/observation/tick", 
                              headers=headers, json=body_1, timeout=10)
    print(f"Status: {response_3.status_code}")
    print(f"Response: {json.dumps(response_3.json(), indent=2)}")
    
    assert response_3.status_code == 200, f"Expected 200 for duplicate, got {response_3.status_code}"
    data_3 = response_3.json()
    assert data_3.get('duplicate') == True, f"Expected duplicate=true for retry, got {data_3.get('duplicate')}"
    
    print(f"✓ Tick deduplication working correctly")

test("3. POST /api/v1/observation/tick with timestamps and deduplication", test_observation_tick_with_timestamps)

# ============================================================================
# NEW FEATURE TEST 4: POST /api/v1/observation/event (1m candle)
# ============================================================================
def test_observation_event_candle():
    """POST /api/v1/observation/event with 1m candle aligned to previous full minute"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY, 'Content-Type': 'application/json'}
    
    # Calculate timestamp = start of the previous full minute (aligned to 60s)
    now = datetime.now(timezone.utc)
    # Round down to the previous minute
    timestamp = now.replace(second=0, microsecond=0) - timedelta(minutes=1)
    close_timestamp = timestamp + timedelta(seconds=60)
    
    body = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": session_id or f"test-session-{uuid4()}",
        "dedupe_id": f"candle-{uuid4()}",
        "observationMethod": "visible-dom-only",
        "symbol": "GBP/USD (OTC)",
        "providerSymbol": "GBP/USD (OTC)",
        "timeframe": "1m",
        "timestamp": timestamp.isoformat().replace('+00:00', 'Z'),
        "closeTimestamp": close_timestamp.isoformat().replace('+00:00', 'Z'),
        "open": 1.27,
        "high": 1.2712,
        "low": 1.2695,
        "close": 1.2705,
        "volume": None
    }
    
    print(f"Candle timestamp: {body['timestamp']}")
    print(f"Candle closeTimestamp: {body['closeTimestamp']}")
    print(f"Request body: {json.dumps(body, indent=2)}")
    
    response = requests.post(f"{BACKEND_URL}/api/v1/observation/event", 
                            headers=headers, json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text}"
    data = response.json()
    assert data.get('ok') == True, f"Expected ok=true, got {data.get('ok')}"
    
    print(f"✓ Candle ingestion successful")

test("4. POST /api/v1/observation/event (1m candle)", test_observation_event_candle)

# ============================================================================
# NEW FEATURE TEST 5: Wait and verify mirror counts increased
# ============================================================================
def test_mirror_counts_increased():
    """Wait 3 seconds, GET /api/health again → postgres.mirror.rows increased correctly"""
    if initial_counts is None:
        print("Skipping: initial counts not available")
        return
    
    print("Waiting 3 seconds for mirror to process...")
    time.sleep(3)
    
    response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    
    postgres = data.get('postgres', {})
    mirror = postgres.get('mirror', {})
    rows = mirror.get('rows', {})
    
    ticks_after = rows.get('observer_ticks', 0)
    candles_after = rows.get('observer_candles', 0)
    failed = mirror.get('failed', 0)
    
    print(f"Counts before: ticks={initial_counts['ticks_before']}, candles={initial_counts['candles_before']}")
    print(f"Counts after: ticks={ticks_after}, candles={candles_after}")
    print(f"Failed: {failed}")
    
    ticks_increase = ticks_after - initial_counts['ticks_before']
    candles_increase = candles_after - initial_counts['candles_before']
    
    print(f"Increase: ticks=+{ticks_increase}, candles=+{candles_increase}")
    
    assert ticks_increase == 2, f"Expected observer_ticks to increase by exactly 2, got {ticks_increase}"
    assert candles_increase == 1, f"Expected observer_candles to increase by exactly 1, got {candles_increase}"
    assert failed == 0 or mirror.get('failed', 0) == initial_counts.get('failed_before', 0), \
        f"Expected failed count to not increase, but it did: {failed}"
    
    print(f"✓ Mirror counts increased correctly: +2 ticks, +1 candle")

test("5. Verify postgres.mirror.rows increased correctly", test_mirror_counts_increased)

# ============================================================================
# NEW FEATURE TEST 6: GET /api/v1/observation with ageSeconds
# ============================================================================
def test_observation_status():
    """GET /api/v1/observation → state DATA_RECEIVING, has numeric ageSeconds < 30 and freshnessSeconds == 30"""
    response = requests.get(f"{BACKEND_URL}/api/v1/observation", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    
    assert data.get('source') == 'market-qx-observer-v2', \
        f"Expected source='market-qx-observer-v2', got {data.get('source')}"
    assert data.get('state') == 'DATA_RECEIVING', \
        f"Expected state='DATA_RECEIVING', got {data.get('state')}"
    
    age_seconds = data.get('ageSeconds')
    assert age_seconds is not None, "Expected ageSeconds to be present"
    assert isinstance(age_seconds, (int, float)), f"Expected ageSeconds to be numeric, got {type(age_seconds)}"
    assert age_seconds < 30, f"Expected ageSeconds < 30, got {age_seconds}"
    
    freshness_seconds = data.get('freshnessSeconds')
    assert freshness_seconds == 30, f"Expected freshnessSeconds == 30, got {freshness_seconds}"
    
    print(f"✓ Observer status: state={data.get('state')}, ageSeconds={age_seconds:.2f}, freshnessSeconds={freshness_seconds}")

test("6. GET /api/v1/observation with ageSeconds", test_observation_status)

# ============================================================================
# NEW FEATURE TEST 7: GET /api/v1/runtime with providers
# ============================================================================
def test_runtime_providers():
    """GET /api/v1/runtime → providers include market-qx-observer-v2 and deriv with correct states"""
    response = requests.get(f"{BACKEND_URL}/api/v1/runtime", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    
    providers = data.get('providers', [])
    assert isinstance(providers, list), "Expected providers to be a list"
    
    # Find observer provider
    observer_provider = None
    deriv_provider = None
    
    for provider in providers:
        if provider.get('source') == 'market-qx-observer-v2':
            observer_provider = provider
        elif provider.get('source') == 'deriv':
            deriv_provider = provider
    
    # Check observer provider
    assert observer_provider is not None, "Expected to find 'market-qx-observer-v2' provider"
    assert observer_provider.get('state') == 'DATA_RECEIVING', \
        f"Expected observer state='DATA_RECEIVING', got {observer_provider.get('state')}"
    
    age_seconds = observer_provider.get('ageSeconds')
    assert age_seconds is not None, "Expected observer ageSeconds to be present"
    assert isinstance(age_seconds, (int, float)), f"Expected ageSeconds to be numeric, got {type(age_seconds)}"
    
    # Check deriv provider
    assert deriv_provider is not None, "Expected to find 'deriv' provider"
    assert deriv_provider.get('state') == 'DATA_RECEIVING', \
        f"Expected deriv state='DATA_RECEIVING', got {deriv_provider.get('state')}"
    
    accepted_count = deriv_provider.get('acceptedCount', 0)
    assert accepted_count >= 30, f"Expected deriv acceptedCount >= 30, got {accepted_count}"
    
    print(f"✓ Runtime providers: observer={observer_provider.get('state')}, deriv={deriv_provider.get('state')} ({accepted_count} symbols)")

test("7. GET /api/v1/runtime with providers", test_runtime_providers)

# ============================================================================
# NEW FEATURE TEST 8: GET /api/v1/market/state
# ============================================================================
def test_market_state():
    """GET /api/v1/market/state?source=market-qx-observer-v2&symbol=GBP%2FUSD%20(OTC)&timeframe=1m → state LIVE, candles non-empty"""
    params = {
        'source': 'market-qx-observer-v2',
        'symbol': 'GBP/USD (OTC)',
        'timeframe': '1m'
    }
    
    response = requests.get(f"{BACKEND_URL}/api/v1/market/state", params=params, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Request params: {params}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    
    assert data.get('state') == 'LIVE', \
        f"Expected state='LIVE', got {data.get('state')}"
    
    candles = data.get('candles', [])
    assert isinstance(candles, list), "Expected candles to be a list"
    assert len(candles) > 0, "Expected candles to be non-empty"
    
    print(f"✓ Market state: state={data.get('state')}, candles count={len(candles)}")

test("8. GET /api/v1/market/state for GBP/USD (OTC)", test_market_state)

# ============================================================================
# REGRESSION TEST 9: GET /api/v1/observation/check without key → 401
# ============================================================================
def test_observation_check_no_key():
    """GET /api/v1/observation/check without key → 401"""
    response = requests.get(f"{BACKEND_URL}/api/v1/observation/check", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
    
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    print(f"✓ Authentication working: 401 without key")

test("9. Regression: GET /api/v1/observation/check without key → 401", test_observation_check_no_key)

# ============================================================================
# REGRESSION TEST 10: GET /api/v1/observer/download → zip
# ============================================================================
def test_observer_download():
    """GET /api/v1/observer/download → zip"""
    response = requests.get(f"{BACKEND_URL}/api/v1/observer/download", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Content-Type: {response.headers.get('Content-Type')}")
    print(f"Content-Length: {len(response.content)} bytes")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'application/zip' in response.headers.get('Content-Type', ''), \
        f"Expected Content-Type to contain 'application/zip', got {response.headers.get('Content-Type')}"
    
    # Verify it's a valid zip file
    zip_buffer = BytesIO(response.content)
    with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
        file_list = zip_file.namelist()
        print(f"Files in zip: {file_list}")
        assert len(file_list) > 0, "Expected zip to contain files"
    
    print(f"✓ Observer download: valid zip with {len(file_list)} files")

test("10. Regression: GET /api/v1/observer/download → zip", test_observer_download)

# ============================================================================
# REGRESSION TEST 11: GET /api/v1/instruments → 200
# ============================================================================
def test_instruments():
    """GET /api/v1/instruments → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/instruments", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response items count: {len(data.get('items', []))}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"
    
    print(f"✓ Instruments: {len(data['items'])} items")

test("11. Regression: GET /api/v1/instruments → 200", test_instruments)

# ============================================================================
# REGRESSION TEST 12: GET /api/v1/events → 200
# ============================================================================
def test_events():
    """GET /api/v1/events → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/events", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response items count: {len(data.get('items', []))}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"
    
    print(f"✓ Events: {len(data['items'])} items")

test("12. Regression: GET /api/v1/events → 200", test_events)

# ============================================================================
# REGRESSION TEST 13: GET /api/v1/modules → 200
# ============================================================================
def test_modules():
    """GET /api/v1/modules → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/modules", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response items count: {len(data.get('items', []))}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"
    
    print(f"✓ Modules: {len(data['items'])} items")

test("13. Regression: GET /api/v1/modules → 200", test_modules)

# ============================================================================
# REGRESSION TEST 14: Demo session and account
# ============================================================================
def test_demo_session_and_account():
    """POST /api/v1/demo/session then GET /api/v1/demo/account → 200"""
    session = requests.Session()
    
    # Create session
    response = session.post(f"{BACKEND_URL}/api/v1/demo/session", timeout=10)
    print(f"Session creation status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'balanceCents' in data, "Expected 'balanceCents' field in response"
    
    # Get account
    response = session.get(f"{BACKEND_URL}/api/v1/demo/account", timeout=10)
    print(f"Account retrieval status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'balanceCents' in data, "Expected 'balanceCents' field in response"
    
    print(f"✓ Demo session and account working")

test("14. Regression: Demo session and account", test_demo_session_and_account)

# ============================================================================
# SUMMARY
# ============================================================================
print("\n" + "=" * 80)
print("TEST SUMMARY")
print("=" * 80)

passed = sum(1 for _, result in test_results if result == "PASS")
failed = sum(1 for _, result in test_results if result in ["FAIL", "ERROR"])
total = len(test_results)

print(f"\nTotal Tests: {total}")
print(f"Passed: {passed}")
print(f"Failed: {failed}")
print(f"Success Rate: {passed/total*100:.1f}%")

if failed_tests:
    print("\n" + "=" * 80)
    print("FAILED TESTS DETAILS")
    print("=" * 80)
    for name, error in failed_tests:
        print(f"\n❌ {name}")
        print(f"   {error}")

print("\n" + "=" * 80)
print("TEST EXECUTION COMPLETE")
print("=" * 80)
