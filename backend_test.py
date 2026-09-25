#!/usr/bin/env python3
"""Backend testing for PostgreSQL mirror features - Master Candle FastAPI app"""
import subprocess
import json
import time
import sys
import os
from datetime import datetime

# Configuration
BACKEND_URL = "https://candel-deploy.preview.emergentagent.com/api"
OBSERVER_KEY = "pjmB2giJPIdWLD2JC2lO-PMdKhhJnUGnu0-QVVdZuqwwqizE9fWmLSEHl1MP4f4R"

def curl_get(endpoint, headers=None):
    """Execute curl GET request"""
    cmd = ["curl", "-s", "-w", "\\n%{http_code}", f"{BACKEND_URL}{endpoint}"]
    if headers:
        for key, value in headers.items():
            cmd.extend(["-H", f"{key}: {value}"])
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    output = result.stdout.strip()
    lines = output.rsplit('\n', 1)
    
    if len(lines) == 2:
        body, status_code = lines
        return int(status_code), body
    return 0, output

def curl_post(endpoint, data=None, headers=None):
    """Execute curl POST request"""
    cmd = ["curl", "-s", "-w", "\\n%{http_code}", "-X", "POST", f"{BACKEND_URL}{endpoint}"]
    
    if headers:
        for key, value in headers.items():
            cmd.extend(["-H", f"{key}: {value}"])
    
    if data:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    output = result.stdout.strip()
    lines = output.rsplit('\n', 1)
    
    if len(lines) == 2:
        body, status_code = lines
        return int(status_code), body
    return 0, output

def test_1_mirror_status_and_live_stream():
    """Test 1: GET /api/v1/postgres/mirror - status and live stream verification"""
    print("\n" + "="*80)
    print("TEST 1: GET /api/v1/postgres/mirror - Status and Live Stream")
    print("="*80)
    
    # Initial GET
    status, body = curl_get("/v1/postgres/mirror")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        print(f"Response: {body}")
        return False
    
    try:
        data = json.loads(body)
        print(f"Response: {json.dumps(data, indent=2)}")
    except json.JSONDecodeError as e:
        print(f"❌ FAILED: Invalid JSON response: {e}")
        print(f"Body: {body}")
        return False
    
    # Verify required fields
    checks = [
        ("enabled", True, data.get("enabled")),
        ("state", "CONNECTED", data.get("state")),
    ]
    
    failed = False
    for field, expected, actual in checks:
        if actual != expected:
            print(f"❌ FAILED: {field} expected {expected}, got {actual}")
            failed = True
        else:
            print(f"✅ {field}: {actual}")
    
    # Check settings object
    if "settings" not in data:
        print("❌ FAILED: Missing 'settings' object")
        failed = True
    else:
        settings = data["settings"]
        required_settings = ["derivMirrorEnabled", "tickRetentionDays", "candleRetentionDays"]
        for key in required_settings:
            if key not in settings:
                print(f"❌ FAILED: Missing settings.{key}")
                failed = True
            else:
                print(f"✅ settings.{key}: {settings[key]}")
    
    # Check deriv object
    if "deriv" not in data:
        print("❌ FAILED: Missing 'deriv' object")
        failed = True
    else:
        deriv = data["deriv"]
        required_deriv = ["ticks", "candles", "failed", "dropped", "lastFlush", "pendingTicks", "pendingCandles"]
        for key in required_deriv:
            if key not in deriv:
                print(f"❌ FAILED: Missing deriv.{key}")
                failed = True
            else:
                print(f"✅ deriv.{key}: {deriv[key]}")
    
    # Check observer object
    if "observer" not in data:
        print("❌ FAILED: Missing 'observer' object")
        failed = True
    else:
        observer = data["observer"]
        required_observer = ["ticks", "candles", "failed"]
        for key in required_observer:
            if key not in observer:
                print(f"❌ FAILED: Missing observer.{key}")
                failed = True
            else:
                print(f"✅ observer.{key}: {observer[key]}")
    
    # Check rows object
    if "rows" not in data:
        print("❌ FAILED: Missing 'rows' object")
        failed = True
    else:
        rows = data["rows"]
        if rows is None:
            print("❌ FAILED: rows is null")
            failed = True
        else:
            required_rows = ["deriv_ticks", "deriv_candles", "observer_ticks", "observer_candles"]
            for key in required_rows:
                if key not in rows:
                    print(f"❌ FAILED: Missing rows.{key}")
                    failed = True
                else:
                    print(f"✅ rows.{key}: {rows[key]}")
            
            # Record initial deriv_ticks count
            initial_deriv_ticks = rows.get("deriv_ticks", 0)
            initial_failed = data.get("deriv", {}).get("failed", 0)
            
            print(f"\n📊 Initial deriv_ticks: {initial_deriv_ticks}")
            print(f"📊 Initial deriv.failed: {initial_failed}")
            
            # Wait 12 seconds for live stream to mirror data
            print("\n⏳ Waiting 12 seconds for live Deriv stream to mirror data...")
            time.sleep(12)
            
            # Second GET to verify increase
            print("\n🔄 Fetching mirror status again...")
            status2, body2 = curl_get("/v1/postgres/mirror")
            
            if status2 != 200:
                print(f"❌ FAILED: Second GET returned {status2}")
                return False
            
            try:
                data2 = json.loads(body2)
                rows2 = data2.get("rows", {})
                new_deriv_ticks = rows2.get("deriv_ticks", 0)
                new_failed = data2.get("deriv", {}).get("failed", 0)
                
                print(f"📊 New deriv_ticks: {new_deriv_ticks}")
                print(f"📊 New deriv.failed: {new_failed}")
                
                if new_deriv_ticks > initial_deriv_ticks:
                    print(f"✅ deriv_ticks increased by {new_deriv_ticks - initial_deriv_ticks} (live stream working)")
                else:
                    print(f"❌ FAILED: deriv_ticks did not increase (expected > {initial_deriv_ticks}, got {new_deriv_ticks})")
                    failed = True
                
                if new_failed == initial_failed:
                    print(f"✅ deriv.failed unchanged ({new_failed})")
                else:
                    print(f"⚠️  WARNING: deriv.failed changed from {initial_failed} to {new_failed}")
                    
            except json.JSONDecodeError as e:
                print(f"❌ FAILED: Invalid JSON in second response: {e}")
                return False
    
    if failed:
        print("\n❌ TEST 1 FAILED")
        return False
    
    print("\n✅ TEST 1 PASSED")
    return True

def test_2_mirror_settings_update():
    """Test 2: POST /api/v1/postgres/mirror - Settings update and validation"""
    print("\n" + "="*80)
    print("TEST 2: POST /api/v1/postgres/mirror - Settings Update")
    print("="*80)
    
    all_passed = True
    
    # Test 2a: Update tickRetentionDays to 9
    print("\n--- Test 2a: Update tickRetentionDays to 9 ---")
    status, body = curl_post("/v1/postgres/mirror", {"tickRetentionDays": 9})
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        print(f"Response: {body}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            print(f"Response: {json.dumps(data, indent=2)}")
            
            if data.get("ok") != True:
                print(f"❌ FAILED: ok is not true")
                all_passed = False
            else:
                print(f"✅ ok: true")
            
            if data.get("settings", {}).get("tickRetentionDays") != 9:
                print(f"❌ FAILED: tickRetentionDays not 9")
                all_passed = False
            else:
                print(f"✅ settings.tickRetentionDays: 9")
            
            if data.get("persisted") != True:
                print(f"❌ FAILED: persisted is not true")
                all_passed = False
            else:
                print(f"✅ persisted: true")
                
        except json.JSONDecodeError as e:
            print(f"❌ FAILED: Invalid JSON: {e}")
            all_passed = False
    
    # Verify persistence with GET
    print("\n--- Verify persistence with GET ---")
    status, body = curl_get("/v1/postgres/mirror")
    if status == 200:
        try:
            data = json.loads(body)
            if data.get("settings", {}).get("tickRetentionDays") == 9:
                print(f"✅ GET confirms tickRetentionDays: 9")
            else:
                print(f"❌ FAILED: GET shows tickRetentionDays: {data.get('settings', {}).get('tickRetentionDays')}")
                all_passed = False
        except json.JSONDecodeError:
            pass
    
    # Test 2b: Update multiple settings with applyNow
    print("\n--- Test 2b: Update multiple settings with applyNow ---")
    payload = {
        "tickRetentionDays": 7,
        "candleRetentionDays": 30,
        "derivMirrorEnabled": True,
        "applyNow": True
    }
    status, body = curl_post("/v1/postgres/mirror", payload)
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        print(f"Response: {body}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            print(f"Response: {json.dumps(data, indent=2)}")
            
            if "removed" not in data:
                print(f"❌ FAILED: Missing 'removed' object")
                all_passed = False
            else:
                removed = data["removed"]
                if removed is None:
                    print(f"⚠️  WARNING: removed is null (no rows to remove)")
                else:
                    required_keys = ["deriv_ticks", "deriv_candles", "observer_ticks", "observer_candles"]
                    for key in required_keys:
                        if key not in removed:
                            print(f"❌ FAILED: Missing removed.{key}")
                            all_passed = False
                        else:
                            print(f"✅ removed.{key}: {removed[key]}")
        except json.JSONDecodeError as e:
            print(f"❌ FAILED: Invalid JSON: {e}")
            all_passed = False
    
    # Test 2c: Validation - tickRetentionDays = 0
    print("\n--- Test 2c: Validation - tickRetentionDays = 0 (should fail) ---")
    status, body = curl_post("/v1/postgres/mirror", {"tickRetentionDays": 0})
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    # Test 2d: Validation - candleRetentionDays = 5000
    print("\n--- Test 2d: Validation - candleRetentionDays = 5000 (should fail) ---")
    status, body = curl_post("/v1/postgres/mirror", {"candleRetentionDays": 5000})
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    # Test 2e: Validation - empty body
    print("\n--- Test 2e: Validation - empty body (should fail) ---")
    status, body = curl_post("/v1/postgres/mirror", {})
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    # Test 2f: Validation - unknown field
    print("\n--- Test 2f: Validation - unknown field (should fail) ---")
    status, body = curl_post("/v1/postgres/mirror", {"unknown": 1})
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    if all_passed:
        print("\n✅ TEST 2 PASSED")
    else:
        print("\n❌ TEST 2 FAILED")
    
    return all_passed

def test_3_analytics_endpoint():
    """Test 3: GET /api/v1/postgres/analytics - Analytics data"""
    print("\n" + "="*80)
    print("TEST 3: GET /api/v1/postgres/analytics - Analytics")
    print("="*80)
    
    all_passed = True
    
    # Test 3a: GET with days=7
    print("\n--- Test 3a: GET /api/v1/postgres/analytics?days=7 ---")
    status, body = curl_get("/v1/postgres/analytics?days=7")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        print(f"Response: {body}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            print(f"Response keys: {list(data.keys())}")
            
            # Check required fields
            if data.get("enabled") != True:
                print(f"❌ FAILED: enabled is not true")
                all_passed = False
            else:
                print(f"✅ enabled: true")
            
            if data.get("days") != 7:
                print(f"❌ FAILED: days is not 7")
                all_passed = False
            else:
                print(f"✅ days: 7")
            
            # Check pairs array
            if "pairs" not in data:
                print(f"❌ FAILED: Missing 'pairs' array")
                all_passed = False
            else:
                pairs = data["pairs"]
                print(f"✅ pairs array present with {len(pairs)} items")
                
                # Look for deriv rows
                deriv_pairs = [p for p in pairs if p.get("source") == "deriv"]
                observer_pairs = [p for p in pairs if p.get("source") == "market-qx-observer-v2"]
                
                print(f"  - Deriv pairs: {len(deriv_pairs)}")
                print(f"  - Observer pairs: {len(observer_pairs)}")
                
                # Check for frxEURUSD with ticks and candles
                eur_usd = next((p for p in deriv_pairs if "EUR" in p.get("symbol", "") and "USD" in p.get("symbol", "")), None)
                if eur_usd:
                    print(f"  - Found EUR/USD pair: {eur_usd}")
                    if eur_usd.get("ticks", 0) > 0 and eur_usd.get("candles", 0) > 0:
                        print(f"    ✅ EUR/USD has ticks ({eur_usd['ticks']}) and candles ({eur_usd['candles']})")
                    else:
                        print(f"    ⚠️  EUR/USD ticks={eur_usd.get('ticks')}, candles={eur_usd.get('candles')}")
                else:
                    print(f"  ⚠️  No EUR/USD pair found in deriv data")
                
                # Verify observer pairs have correct source
                if observer_pairs:
                    print(f"  ✅ Observer pairs present with source 'market-qx-observer-v2'")
            
            # Check daily array
            if "daily" not in data:
                print(f"❌ FAILED: Missing 'daily' array")
                all_passed = False
            else:
                daily = data["daily"]
                print(f"✅ daily array present with {len(daily)} items")
                
                # Check for today's date
                today = datetime.utcnow().date().isoformat()
                today_entry = next((d for d in daily if d.get("date") == today), None)
                
                if today_entry:
                    print(f"  - Today's entry: {today_entry}")
                    if today_entry.get("derivTicks", 0) > 0:
                        print(f"    ✅ Today has derivTicks: {today_entry['derivTicks']}")
                    else:
                        print(f"    ⚠️  Today's derivTicks: {today_entry.get('derivTicks', 0)}")
                else:
                    print(f"  ⚠️  No entry for today ({today})")
            
            # Check totals object
            if "totals" not in data:
                print(f"❌ FAILED: Missing 'totals' object")
                all_passed = False
            else:
                totals = data["totals"]
                print(f"✅ totals: {totals}")
            
            # Check mirror.settings
            if "mirror" not in data or "settings" not in data.get("mirror", {}):
                print(f"❌ FAILED: Missing mirror.settings")
                all_passed = False
            else:
                print(f"✅ mirror.settings present: {data['mirror']['settings']}")
                
        except json.JSONDecodeError as e:
            print(f"❌ FAILED: Invalid JSON: {e}")
            all_passed = False
    
    # Test 3b: GET with days=1
    print("\n--- Test 3b: GET /api/v1/postgres/analytics?days=1 ---")
    status, body = curl_get("/v1/postgres/analytics?days=1")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            if data.get("days") == 1:
                print(f"✅ days=1 accepted")
            else:
                print(f"❌ FAILED: days is {data.get('days')}, expected 1")
                all_passed = False
        except json.JSONDecodeError:
            pass
    
    # Test 3c: GET with days=30
    print("\n--- Test 3c: GET /api/v1/postgres/analytics?days=30 ---")
    status, body = curl_get("/v1/postgres/analytics?days=30")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            if data.get("days") == 30:
                print(f"✅ days=30 accepted")
            else:
                print(f"❌ FAILED: days is {data.get('days')}, expected 30")
                all_passed = False
        except json.JSONDecodeError:
            pass
    
    # Test 3d: Validation - days=0
    print("\n--- Test 3d: Validation - days=0 (should fail) ---")
    status, body = curl_get("/v1/postgres/analytics?days=0")
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    # Test 3e: Validation - days=91
    print("\n--- Test 3e: Validation - days=91 (should fail) ---")
    status, body = curl_get("/v1/postgres/analytics?days=91")
    print(f"Status: {status}")
    
    if status != 422:
        print(f"❌ FAILED: Expected 422, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 422")
    
    if all_passed:
        print("\n✅ TEST 3 PASSED")
    else:
        print("\n❌ TEST 3 FAILED")
    
    return all_passed

def test_4_regression_tests():
    """Test 4: Regression tests for existing endpoints"""
    print("\n" + "="*80)
    print("TEST 4: Regression Tests")
    print("="*80)
    
    all_passed = True
    
    # Test 4a: GET /api/health
    print("\n--- Test 4a: GET /api/health ---")
    status, body = curl_get("/health")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            print(f"Response keys: {list(data.keys())}")
            
            # Check postgres.state
            postgres = data.get("postgres", {})
            if postgres.get("state") != "CONNECTED":
                print(f"❌ FAILED: postgres.state is {postgres.get('state')}, expected CONNECTED")
                all_passed = False
            else:
                print(f"✅ postgres.state: CONNECTED")
            
            # Check postgres.mirror.rows
            mirror = postgres.get("mirror", {})
            rows = mirror.get("rows", {})
            
            if not rows:
                print(f"❌ FAILED: postgres.mirror.rows is empty or missing")
                all_passed = False
            else:
                required_keys = ["deriv_ticks", "deriv_candles", "observer_ticks", "observer_candles"]
                for key in required_keys:
                    if key not in rows:
                        print(f"❌ FAILED: Missing postgres.mirror.rows.{key}")
                        all_passed = False
                    else:
                        print(f"✅ postgres.mirror.rows.{key}: {rows[key]}")
            
            # Check postgres.mirror.settings
            if "settings" not in mirror:
                print(f"❌ FAILED: Missing postgres.mirror.settings")
                all_passed = False
            else:
                print(f"✅ postgres.mirror.settings present: {mirror['settings']}")
                
        except json.JSONDecodeError as e:
            print(f"❌ FAILED: Invalid JSON: {e}")
            all_passed = False
    
    # Test 4b: GET /api/v1/runtime
    print("\n--- Test 4b: GET /api/v1/runtime ---")
    status, body = curl_get("/v1/runtime")
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        all_passed = False
    else:
        try:
            data = json.loads(body)
            
            # Find deriv provider
            providers = data.get("providers", [])
            deriv = next((p for p in providers if p.get("source") == "deriv"), None)
            
            if not deriv:
                print(f"❌ FAILED: No deriv provider found")
                all_passed = False
            else:
                if deriv.get("state") != "DATA_RECEIVING":
                    print(f"❌ FAILED: deriv state is {deriv.get('state')}, expected DATA_RECEIVING")
                    all_passed = False
                else:
                    print(f"✅ deriv.state: DATA_RECEIVING")
                
                accepted_count = deriv.get("acceptedCount", 0)
                if accepted_count < 30:
                    print(f"❌ FAILED: deriv.acceptedCount is {accepted_count}, expected >= 30")
                    all_passed = False
                else:
                    print(f"✅ deriv.acceptedCount: {accepted_count} (>= 30)")
                    
        except json.JSONDecodeError as e:
            print(f"❌ FAILED: Invalid JSON: {e}")
            all_passed = False
    
    # Test 4c: Observer /check endpoint without key (should fail)
    print("\n--- Test 4c: GET /api/v1/observation/check without key (should fail) ---")
    status, body = curl_get("/v1/observation/check")
    print(f"Status: {status}")
    
    if status != 401:
        print(f"❌ FAILED: Expected 401, got {status}")
        all_passed = False
    else:
        print(f"✅ Correctly rejected with 401")
    
    # Test 4d: Observer /check endpoint with key (should succeed)
    print("\n--- Test 4d: GET /api/v1/observation/check with key (should succeed) ---")
    status, body = curl_get("/v1/observation/check", headers={"X-Market-QX-Key": OBSERVER_KEY})
    print(f"Status: {status}")
    
    if status != 200:
        print(f"❌ FAILED: Expected 200, got {status}")
        all_passed = False
    else:
        print(f"✅ Authenticated successfully with 200")
    
    # Test 4e: POST observer tick and verify mirror increase
    print("\n--- Test 4e: POST /api/v1/observation/tick and verify mirror increase ---")
    
    # Get initial count
    status, body = curl_get("/v1/postgres/mirror")
    if status == 200:
        try:
            data = json.loads(body)
            initial_observer_ticks = data.get("rows", {}).get("observer_ticks", 0)
            print(f"Initial observer_ticks: {initial_observer_ticks}")
            
            # Post a tick
            now = datetime.utcnow().isoformat() + "Z"
            session_id = f"test-session-{int(time.time())}"
            dedupe_id = f"test-dedupe-{int(time.time() * 1000)}"
            
            tick_payload = {
                "source": "MARKET_QX_BROWSER_OBSERVATION",
                "schema_version": 2,
                "session_id": session_id,
                "dedupe_id": dedupe_id,
                "symbol": "EUR/USD (OTC)",
                "price": 1.0850,
                "timestamp": now
            }
            
            status, body = curl_post("/v1/observation/tick", tick_payload, headers={"X-Market-QX-Key": OBSERVER_KEY})
            print(f"POST tick status: {status}")
            
            if status != 200:
                print(f"❌ FAILED: POST tick returned {status}")
                print(f"Response: {body}")
                all_passed = False
            else:
                print(f"✅ Tick posted successfully")
                
                # Wait 2 seconds for mirror
                print("⏳ Waiting 2 seconds for mirror...")
                time.sleep(2)
                
                # Check new count
                status, body = curl_get("/v1/postgres/mirror")
                if status == 200:
                    try:
                        data = json.loads(body)
                        new_observer_ticks = data.get("rows", {}).get("observer_ticks", 0)
                        print(f"New observer_ticks: {new_observer_ticks}")
                        
                        if new_observer_ticks == initial_observer_ticks + 1:
                            print(f"✅ observer_ticks increased by 1")
                        else:
                            print(f"❌ FAILED: observer_ticks expected {initial_observer_ticks + 1}, got {new_observer_ticks}")
                            all_passed = False
                    except json.JSONDecodeError:
                        pass
        except json.JSONDecodeError:
            pass
    
    if all_passed:
        print("\n✅ TEST 4 PASSED")
    else:
        print("\n❌ TEST 4 FAILED")
    
    return all_passed

def test_5_settings_persistence():
    """Test 5: Verify settings persistence in MongoDB"""
    print("\n" + "="*80)
    print("TEST 5: Settings Persistence in MongoDB")
    print("="*80)
    
    try:
        from pymongo import MongoClient
        
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        
        print(f"Connecting to MongoDB: {mongo_url}")
        print(f"Database: {db_name}")
        
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        db = client[db_name]
        
        # Find the postgres_mirror settings document
        doc = db.runtime_settings.find_one({"id": "postgres_mirror"})
        
        if not doc:
            print(f"❌ FAILED: No document found with id='postgres_mirror'")
            return False
        
        print(f"✅ Found document: {doc}")
        
        # Verify tickRetentionDays is 7 (from test 2)
        if doc.get("tickRetentionDays") == 7:
            print(f"✅ tickRetentionDays: 7 (persisted correctly)")
        else:
            print(f"❌ FAILED: tickRetentionDays is {doc.get('tickRetentionDays')}, expected 7")
            return False
        
        print("\n✅ TEST 5 PASSED")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: MongoDB check failed: {e}")
        return False

def main():
    """Run all tests"""
    print("="*80)
    print("BACKEND TESTING: PostgreSQL Mirror Features")
    print("Master Candle FastAPI App")
    print("="*80)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Observer Key: {OBSERVER_KEY[:20]}...")
    
    results = []
    
    # Run all tests
    results.append(("Test 1: Mirror Status & Live Stream", test_1_mirror_status_and_live_stream()))
    results.append(("Test 2: Settings Update", test_2_mirror_settings_update()))
    results.append(("Test 3: Analytics Endpoint", test_3_analytics_endpoint()))
    results.append(("Test 4: Regression Tests", test_4_regression_tests()))
    results.append(("Test 5: Settings Persistence", test_5_settings_persistence()))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
