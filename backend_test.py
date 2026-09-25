#!/usr/bin/env python3
"""
Backend API Testing for Master Candle FastAPI App
Tests all backend endpoints as specified in the review request.
"""

import requests
import json
import time
from datetime import datetime, timezone
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
        func()
        test_results.append((name, "PASS"))
        print(f"✅ PASS: {name}")
    except AssertionError as e:
        test_results.append((name, "FAIL"))
        failed_tests.append((name, str(e)))
        print(f"❌ FAIL: {name}")
        print(f"   Error: {e}")
    except Exception as e:
        test_results.append((name, "ERROR"))
        failed_tests.append((name, f"Exception: {e}"))
        print(f"❌ ERROR: {name}")
        print(f"   Exception: {e}")

# ============================================================================
# TEST 1: Health Endpoint
# ============================================================================
def test_health():
    """GET /api/health → 200, database "connected", postgres.state must be "CONNECTED" (enabled true)"""
    response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get('database') == 'connected', f"Expected database='connected', got {data.get('database')}"
    
    postgres = data.get('postgres', {})
    assert postgres.get('enabled') == True, f"Expected postgres.enabled=true, got {postgres.get('enabled')}"
    assert postgres.get('state') == 'CONNECTED', f"Expected postgres.state='CONNECTED', got {postgres.get('state')}"

test("1. Health Endpoint", test_health)

# ============================================================================
# TEST 2: Root Endpoint
# ============================================================================
def test_root():
    """GET /api/ → message string"""
    response = requests.get(f"{BACKEND_URL}/api/", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'message' in data, "Expected 'message' field in response"
    assert isinstance(data['message'], str), "Expected message to be a string"

test("2. Root Endpoint", test_root)

# ============================================================================
# TEST 3: Runtime Endpoint
# ============================================================================
def test_runtime():
    """GET /api/v1/runtime → providers[] contains source "deriv" with state DATA_RECEIVING and acceptedCount >= 30"""
    response = requests.get(f"{BACKEND_URL}/api/v1/runtime", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'providers' in data, "Expected 'providers' field in response"
    
    providers = data['providers']
    assert isinstance(providers, list), "Expected providers to be a list"
    
    # Check for deriv provider
    deriv_provider = None
    observer_provider = None
    
    for provider in providers:
        if provider.get('source') == 'deriv':
            deriv_provider = provider
        elif provider.get('source') == 'market-qx-observer-v2':
            observer_provider = provider
    
    assert deriv_provider is not None, "Expected to find 'deriv' provider"
    assert deriv_provider.get('state') in ['DATA_RECEIVING', 'CONNECTED'], \
        f"Expected deriv state to be DATA_RECEIVING or CONNECTED, got {deriv_provider.get('state')}"
    
    accepted_count = deriv_provider.get('acceptedCount', 0)
    assert accepted_count >= 30, f"Expected acceptedCount >= 30, got {accepted_count}"
    
    # Check for observer provider
    assert observer_provider is not None, "Expected to find 'market-qx-observer-v2' provider"
    assert observer_provider.get('state') in ['WAITING_FOR_EXTENSION', 'DATA_RECEIVING', 'STALE'], \
        f"Expected observer state to be WAITING_FOR_EXTENSION, DATA_RECEIVING, or STALE, got {observer_provider.get('state')}"

test("3. Runtime Endpoint", test_runtime)

# ============================================================================
# TEST 4: Instruments Endpoint
# ============================================================================
def test_instruments():
    """GET /api/v1/instruments → items non-empty"""
    response = requests.get(f"{BACKEND_URL}/api/v1/instruments", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:500]}...")  # Print first 500 chars
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"
    assert isinstance(data['items'], list), "Expected items to be a list"
    assert len(data['items']) > 0, "Expected items to be non-empty"
    print(f"Found {len(data['items'])} instruments")

test("4. Instruments Endpoint", test_instruments)

# ============================================================================
# TEST 5: Observation Endpoint
# ============================================================================
def test_observation():
    """GET /api/v1/observation → returns source market-qx-observer-v2"""
    response = requests.get(f"{BACKEND_URL}/api/v1/observation", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get('source') == 'market-qx-observer-v2', \
        f"Expected source='market-qx-observer-v2', got {data.get('source')}"

test("5. Observation Endpoint", test_observation)

# ============================================================================
# TEST 6: Observer Extension Contract - Check Endpoint
# ============================================================================
def test_observation_check_with_key():
    """GET /api/v1/observation/check with header X-Market-QX-Key → 200 {ok:true}"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY}
    response = requests.get(f"{BACKEND_URL}/api/v1/observation/check", headers=headers, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get('ok') == True, f"Expected ok=true, got {data.get('ok')}"

test("6a. Observation Check with Key", test_observation_check_with_key)

def test_observation_check_without_key():
    """GET /api/v1/observation/check without header → 401"""
    response = requests.get(f"{BACKEND_URL}/api/v1/observation/check", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
    
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"

test("6b. Observation Check without Key", test_observation_check_without_key)

# ============================================================================
# TEST 7: Observer Extension Contract - Pairs Endpoint
# ============================================================================
def test_observation_pairs():
    """POST /api/v1/observation/pairs with key and valid body → 200 ok"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY, 'Content-Type': 'application/json'}
    body = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": "test-sess-1",
        "dedupe_id": f"pairs-{uuid4()}",
        "observationMethod": "visible-dom-only",
        "pairs": [
            {
                "symbol": "EURUSD_otc",
                "providerSymbol": "EURUSD_otc",
                "timeframe": "1m"
            }
        ]
    }
    
    response = requests.post(f"{BACKEND_URL}/api/v1/observation/pairs", 
                            headers=headers, json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get('ok') == True, f"Expected ok=true, got {data.get('ok')}"

test("7. Observation Pairs", test_observation_pairs)

# ============================================================================
# TEST 8: Observer Extension Contract - Tick Endpoint
# ============================================================================
def test_observation_tick():
    """POST /api/v1/observation/tick with key → 200"""
    headers = {'X-Market-QX-Key': OBSERVER_KEY, 'Content-Type': 'application/json'}
    
    # First tick with unique dedupe_id
    dedupe_id = f"tick-{uuid4()}"
    body = {
        "source": "MARKET_QX_BROWSER_OBSERVATION",
        "schema_version": 2,
        "session_id": "test-sess-1",
        "dedupe_id": dedupe_id,
        "observationMethod": "visible-dom-only",
        "symbol": "EURUSD_otc",
        "providerSymbol": "EURUSD_otc",
        "price": 1.08512,
        "timeframe": "tick",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    response = requests.post(f"{BACKEND_URL}/api/v1/observation/tick", 
                            headers=headers, json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get('ok') == True, f"Expected ok=true, got {data.get('ok')}"
    assert data.get('duplicate') == False, f"Expected duplicate=false for first tick, got {data.get('duplicate')}"
    
    # Second tick with same dedupe_id should return duplicate=true
    time.sleep(0.5)
    response2 = requests.post(f"{BACKEND_URL}/api/v1/observation/tick", 
                             headers=headers, json=body, timeout=10)
    print(f"\nDuplicate test - Status: {response2.status_code}")
    print(f"Response: {json.dumps(response2.json(), indent=2)}")
    
    assert response2.status_code == 200, f"Expected 200 for duplicate, got {response2.status_code}"
    data2 = response2.json()
    assert data2.get('duplicate') == True, f"Expected duplicate=true for second tick, got {data2.get('duplicate')}"

test("8. Observation Tick with Deduplication", test_observation_tick)

# ============================================================================
# TEST 9: Observer Download Endpoint
# ============================================================================
def test_observer_download():
    """GET /api/v1/observer/download → 200 application/zip containing manifest.json"""
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
        
        assert 'market-qx-observer-v2/manifest.json' in file_list, \
            "Expected manifest.json in zip"
        
        # Read and verify manifest
        manifest_content = zip_file.read('market-qx-observer-v2/manifest.json')
        manifest = json.loads(manifest_content)
        print(f"Manifest optional_host_permissions: {manifest.get('optional_host_permissions')}")
        
        expected_permission = f"{BACKEND_URL}/*"
        assert expected_permission in manifest.get('optional_host_permissions', []), \
            f"Expected {expected_permission} in optional_host_permissions"

test("9. Observer Download", test_observer_download)

# ============================================================================
# TEST 10: Market Routes - Analysis Latest
# ============================================================================
def test_analysis_latest():
    """GET /api/v1/analysis/latest → 200"""
    # Get an instrument first
    instruments_response = requests.get(f"{BACKEND_URL}/api/v1/instruments", timeout=10)
    instruments = instruments_response.json()['items']
    
    if len(instruments) > 0:
        instrument = instruments[0]
        source = instrument['source']
        symbol = instrument['symbol']
        
        response = requests.get(f"{BACKEND_URL}/api/v1/analysis/latest", 
                               params={'source': source, 'symbol': symbol, 'timeframe': '1m'}, 
                               timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)[:500]}...")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    else:
        print("No instruments available, skipping test")

test("10. Analysis Latest", test_analysis_latest)

# ============================================================================
# TEST 11: Market Routes - Top Pairs
# ============================================================================
def test_top_pairs():
    """GET /api/v1/top-pairs → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/top-pairs", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:500]}...")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"

test("11. Top Pairs", test_top_pairs)

# ============================================================================
# TEST 12: Market Routes - History
# ============================================================================
def test_history():
    """GET /api/v1/history → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/history", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:500]}...")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"

test("12. History", test_history)

# ============================================================================
# TEST 13: Market Routes - Events
# ============================================================================
def test_events():
    """GET /api/v1/events → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/events", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:500]}...")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"

test("13. Events", test_events)

# ============================================================================
# TEST 14: Market Routes - Agents
# ============================================================================
def test_agents():
    """GET /api/v1/agents → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/agents", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

test("14. Agents", test_agents)

# ============================================================================
# TEST 15: Market Routes - Modules
# ============================================================================
def test_modules():
    """GET /api/v1/modules → 200"""
    response = requests.get(f"{BACKEND_URL}/api/v1/modules", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"

test("15. Modules", test_modules)

# ============================================================================
# TEST 16: Market Routes - POST Analysis
# ============================================================================
def test_post_analysis():
    """POST /api/v1/analysis → 200"""
    # Get an instrument first
    instruments_response = requests.get(f"{BACKEND_URL}/api/v1/instruments", timeout=10)
    instruments = instruments_response.json()['items']
    
    if len(instruments) > 0:
        instrument = instruments[0]
        body = {
            "source": instrument['source'],
            "symbol": instrument['symbol'],
            "timeframe": "1m"
        }
        
        response = requests.post(f"{BACKEND_URL}/api/v1/analysis", 
                                json=body, timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)[:500]}...")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    else:
        print("No instruments available, skipping test")

test("16. POST Analysis", test_post_analysis)

# ============================================================================
# TEST 17: Demo Ledger - Session Creation
# ============================================================================
def test_demo_session():
    """POST /api/v1/demo/session → 200 with cookie"""
    session = requests.Session()
    response = session.post(f"{BACKEND_URL}/api/v1/demo/session", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print(f"Cookies: {session.cookies.get_dict()}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'balanceCents' in data, "Expected 'balanceCents' field in response"
    assert data['balanceCents'] == 1_000_000, f"Expected initial balance 1000000, got {data['balanceCents']}"
    assert 'mc_demo_session' in session.cookies, "Expected mc_demo_session cookie to be set"
    
    return session

demo_session = None
test("17. Demo Session Creation", lambda: globals().update({'demo_session': test_demo_session()}))

# ============================================================================
# TEST 18: Demo Ledger - Get Account
# ============================================================================
def test_demo_account():
    """GET /api/v1/demo/account → 200"""
    if demo_session is None:
        print("Skipping: demo session not created")
        return
    
    response = demo_session.get(f"{BACKEND_URL}/api/v1/demo/account", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'balanceCents' in data, "Expected 'balanceCents' field in response"

test("18. Demo Account", test_demo_account)

# ============================================================================
# TEST 19: Demo Ledger - Place Trade
# ============================================================================
def test_demo_place_trade():
    """POST /api/v1/demo/actions (place trade) → 200"""
    if demo_session is None:
        print("Skipping: demo session not created")
        return
    
    body = {
        "requestId": str(uuid4()),
        "kind": "place",
        "pairId": "frxEURUSD",
        "direction": "UP",
        "stakeCents": 10000,
        "duration": 60
    }
    
    response = demo_session.post(f"{BACKEND_URL}/api/v1/demo/actions", 
                                json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert 'balanceCents' in data, "Expected 'balanceCents' field in response"
    assert 'trades' in data, "Expected 'trades' field in response"

test("19. Demo Place Trade", test_demo_place_trade)

# ============================================================================
# TEST 20: Demo Ledger - History
# ============================================================================
def test_demo_history():
    """GET /api/v1/demo/history → 200"""
    if demo_session is None:
        print("Skipping: demo session not created")
        return
    
    response = demo_session.get(f"{BACKEND_URL}/api/v1/demo/history", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:500]}...")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert 'items' in data, "Expected 'items' field in response"

test("20. Demo History", test_demo_history)

# ============================================================================
# TEST 21: Demo Ledger - Reset
# ============================================================================
def test_demo_reset():
    """POST /api/v1/demo/actions (reset) → 200"""
    if demo_session is None:
        print("Skipping: demo session not created")
        return
    
    body = {
        "requestId": str(uuid4()),
        "kind": "reset"
    }
    
    response = demo_session.post(f"{BACKEND_URL}/api/v1/demo/actions", 
                                json=body, timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data['balanceCents'] == 1_000_000, f"Expected balance reset to 1000000, got {data['balanceCents']}"

test("21. Demo Reset", test_demo_reset)

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
