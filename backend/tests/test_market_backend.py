"""Critical API and observer-ingestion regression tests for market backend."""

from __future__ import annotations

import time
import uuid
import io
import json
import zipfile
from urllib.parse import urlparse

import pytest


def _url(base_url: str, path: str) -> str:
    return f"{base_url}{path}"


def _obs_headers(key: str) -> dict[str, str]:
    return {"Content-Type": "application/json", "X-Market-QX-Key": key}


def _session_id() -> str:
    return f"TESTONLY-session-{uuid.uuid4()}"


def _dedupe(tag: str) -> str:
    return f"TESTONLY-{tag}-{uuid.uuid4()}"


def _now_iso(offset_seconds: int = 0) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_seconds))


def _aligned_candle_bounds(seconds: int = 60, shift_windows: int = 1) -> tuple[int, int]:
    now = int(time.time())
    close_epoch = (now // seconds) * seconds - (shift_windows * seconds)
    start_epoch = close_epoch - seconds
    return start_epoch, close_epoch


class TestCoreEndpoints:
    """Health/runtime/public module endpoints."""

    def test_health_endpoint(self, api_client, base_url):
        response = api_client.get(_url(base_url, "/api/health"), timeout=20)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["database"] == "connected"

    def test_runtime_endpoint(self, api_client, base_url):
        response = api_client.get(_url(base_url, "/api/v1/runtime"), timeout=25)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data.get("providers"), list)
        deriv = next((p for p in data["providers"] if p.get("source") == "deriv"), None)
        assert deriv is not None
        assert isinstance(deriv.get("symbolCount", 0), int)

    def test_modules_and_events(self, api_client, base_url):
        modules = api_client.get(_url(base_url, "/api/v1/modules"), timeout=20)
        events = api_client.get(_url(base_url, "/api/v1/events"), timeout=20)
        assert modules.status_code == 200
        assert events.status_code == 200
        assert isinstance(modules.json().get("items"), list)
        assert isinstance(events.json().get("items"), list)

    def test_observer_download_manifest_origin_permission_and_no_key_leak(self, api_client, base_url, observer_key):
        response = api_client.get(_url(base_url, "/api/v1/observer/download"), timeout=30)
        assert response.status_code == 200
        assert response.content

        archive = zipfile.ZipFile(io.BytesIO(response.content))
        manifest_name = next((n for n in archive.namelist() if n.endswith("manifest.json")), None)
        assert manifest_name is not None
        manifest = json.loads(archive.read(manifest_name).decode("utf-8"))

        expected_origin = urlparse(base_url).scheme + "://" + urlparse(base_url).netloc
        optional = manifest.get("optional_host_permissions", [])
        assert optional == [f"{expected_origin}/*"]
        assert "https://*/*" not in optional

        for name in archive.namelist():
            if name.endswith((".js", ".html", ".json", ".md", ".txt")):
                content = archive.read(name).decode("utf-8", errors="ignore")
                assert observer_key not in content


class TestDerivAndAnalysis:
    """Deriv market state and analysis behavior."""

    def test_instruments_and_source_isolation(self, api_client, base_url):
        deriv_instruments = api_client.get(_url(base_url, "/api/v1/instruments?source=deriv"), timeout=25)
        observer_instruments = api_client.get(
            _url(base_url, "/api/v1/instruments?source=market-qx-observer-v2"), timeout=25
        )
        assert deriv_instruments.status_code == 200
        assert observer_instruments.status_code == 200
        assert isinstance(deriv_instruments.json().get("items"), list)
        assert isinstance(observer_instruments.json().get("items"), list)

    def test_deriv_market_state_contains_no_object_id(self, api_client, base_url):
        response = api_client.get(
            _url(base_url, "/api/v1/market/state?source=deriv&symbol=EUR%2FUSD&timeframe=1m"), timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("source") == "deriv"
        assert "_id" not in str(data)

    def test_analysis_and_latest_no_duplicate_signal_history(self, api_client, base_url, mongo_db):
        payload = {"source": "deriv", "symbol": "EUR/USD", "timeframe": "1m"}
        first = api_client.post(_url(base_url, "/api/v1/analysis"), json=payload, timeout=40)
        second = api_client.post(_url(base_url, "/api/v1/analysis"), json=payload, timeout=40)
        latest = api_client.get(
            _url(base_url, "/api/v1/analysis/latest?source=deriv&symbol=EUR%2FUSD&timeframe=1m"), timeout=25
        )
        history = api_client.get(_url(base_url, "/api/v1/history?limit=200"), timeout=25)

        assert first.status_code == 200
        assert second.status_code == 200
        assert latest.status_code == 200
        assert history.status_code == 200

        latest_data = latest.json()
        assert latest_data.get("signal", {}).get("direction") == "NO_SIGNAL"
        latest_symbol = latest_data.get("symbol")
        assert isinstance(latest_symbol, str) and latest_symbol

        target_epoch = latest_data.get("latestEpoch")
        rows = [
            row
            for row in history.json().get("items", [])
            if row.get("source") == "deriv"
            and row.get("symbol") == latest_symbol
            and row.get("timeframe") == "1m"
            and row.get("candleEpoch") == target_epoch
        ]
        assert len(rows) <= 1

        db_count = mongo_db.signal_history.count_documents(
            {
                "source": "deriv",
                "symbol": latest_symbol,
                "timeframe": "1m",
                "candleEpoch": target_epoch,
            }
        )
        assert db_count <= 1

    def test_top_pairs_and_runtime_diagnostics(self, api_client, base_url):
        top = api_client.get(_url(base_url, "/api/v1/top-pairs"), timeout=25)
        runtime = api_client.get(_url(base_url, "/api/v1/runtime"), timeout=25)
        events = api_client.get(_url(base_url, "/api/v1/events"), timeout=25)

        assert top.status_code == 200
        assert runtime.status_code == 200
        assert isinstance(top.json().get("items"), list)

        runtime_data = runtime.json()
        deriv = next((p for p in runtime_data.get("providers", []) if p.get("source") == "deriv"), {})
        assert deriv.get("symbolCount", 0) >= 0

        if deriv.get("error") == "SUBSCRIPTION_REJECTED":
            assert any("Deriv" in row.get("source", "") for row in events.json().get("items", []))


class TestObservationSecurityAndValidation:
    """Observer auth, validation, idempotency and source isolation checks."""

    def test_observation_check_rejects_missing_or_wrong_key(self, api_client, base_url):
        missing = api_client.get(_url(base_url, "/api/v1/observation/check"), timeout=20)
        wrong = api_client.get(
            _url(base_url, "/api/v1/observation/check"),
            headers={"X-Market-QX-Key": "TESTONLY-wrong-key"},
            timeout=20,
        )
        assert missing.status_code == 401
        assert wrong.status_code == 401

    def test_observation_check_accepts_valid_key(self, api_client, base_url, observer_key):
        response = api_client.get(
            _url(base_url, "/api/v1/observation/check"),
            headers={"X-Market-QX-Key": observer_key},
            timeout=20,
        )
        assert response.status_code == 200
        assert response.json().get("ok") is True

    def test_pairs_ingest_and_idempotent_dedupe(self, api_client, base_url, observer_key):
        sid = _session_id()
        dedupe = _dedupe("pairs")
        payload = {
            "source": "MARKET_QX_BROWSER_OBSERVATION",
            "schema_version": 2,
            "session_id": sid,
            "dedupe_id": dedupe,
            "observationMethod": "visible-dom-only",
            "pairs": [{"symbol": "TESTONLY_EUR/USD", "providerSymbol": "TESTONLY_EUR/USD", "timeframe": "1m"}],
        }
        first = api_client.post(
            _url(base_url, "/api/v1/observation/pairs"),
            json=payload,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        second = api_client.post(
            _url(base_url, "/api/v1/observation/pairs"),
            json=payload,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        assert first.status_code == 200
        assert first.json().get("duplicate") is False
        assert second.status_code == 200
        assert second.json().get("duplicate") is True

    def test_tick_validation_nonfinite_nonpositive_and_stale(self, api_client, base_url, observer_key):
        sid = _session_id()
        bad_payloads = [
            {
                "source": "MARKET_QX_BROWSER_OBSERVATION",
                "schema_version": 2,
                "session_id": sid,
                "dedupe_id": _dedupe("tick-zero"),
                "observationMethod": "visible-dom-only",
                "symbol": "TESTONLY_EUR/USD",
                "providerSymbol": "TESTONLY_EUR/USD",
                "price": 0,
                "timestamp": _now_iso(),
                "timeframe": "tick",
            },
            {
                "source": "MARKET_QX_BROWSER_OBSERVATION",
                "schema_version": 2,
                "session_id": sid,
                "dedupe_id": _dedupe("tick-stale"),
                "observationMethod": "visible-dom-only",
                "symbol": "TESTONLY_EUR/USD",
                "providerSymbol": "TESTONLY_EUR/USD",
                "price": 1.12345,
                "timestamp": _now_iso(offset_seconds=-300),
                "timeframe": "tick",
            },
            {
                "source": "MARKET_QX_BROWSER_OBSERVATION",
                "schema_version": 2,
                "session_id": sid,
                "dedupe_id": _dedupe("tick-future"),
                "observationMethod": "visible-dom-only",
                "symbol": "TESTONLY_EUR/USD",
                "providerSymbol": "TESTONLY_EUR/USD",
                "price": 1.12345,
                "timestamp": _now_iso(offset_seconds=10),
                "timeframe": "tick",
            },
        ]
        for payload in bad_payloads:
            response = api_client.post(
                _url(base_url, "/api/v1/observation/tick"),
                json=payload,
                headers=_obs_headers(observer_key),
                timeout=25,
            )
            assert response.status_code == 422

    def test_tick_out_of_order_rejected(self, api_client, base_url, observer_key):
        sid = _session_id()
        now = int(time.time())
        p1 = {
            "source": "MARKET_QX_BROWSER_OBSERVATION",
            "schema_version": 2,
            "session_id": sid,
            "dedupe_id": _dedupe("tick-now"),
            "observationMethod": "visible-dom-only",
            "symbol": "TESTONLY_ORDER/USD",
            "providerSymbol": "TESTONLY_ORDER/USD",
            "price": 1.2222,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "timeframe": "tick",
        }
        p2 = {
            **p1,
            "dedupe_id": _dedupe("tick-past"),
            "price": 1.1111,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 5)),
        }
        first = api_client.post(
            _url(base_url, "/api/v1/observation/tick"),
            json=p1,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        second = api_client.post(
            _url(base_url, "/api/v1/observation/tick"),
            json=p2,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        assert first.status_code == 200
        assert second.status_code == 422

    def test_event_validation_ohlc_and_time_alignment(self, api_client, base_url, observer_key):
        sid = _session_id()
        start_epoch, close_epoch = _aligned_candle_bounds(seconds=60, shift_windows=1)
        valid = {
            "source": "MARKET_QX_BROWSER_OBSERVATION",
            "schema_version": 2,
            "session_id": sid,
            "dedupe_id": _dedupe("event-valid"),
            "observationMethod": "visible-dom-only",
            "symbol": "TESTONLY_EVENT/USD",
            "providerSymbol": "TESTONLY_EVENT/USD",
            "timeframe": "1m",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_epoch)),
            "closeTimestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(close_epoch)),
            "open": 1.2,
            "high": 1.3,
            "low": 1.1,
            "close": 1.25,
            "volume": 10,
        }
        bad = {
            **valid,
            "dedupe_id": _dedupe("event-bad"),
            "high": 1.15,
            "close": 1.22,
        }
        ok = api_client.post(
            _url(base_url, "/api/v1/observation/event"),
            json=valid,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        reject = api_client.post(
            _url(base_url, "/api/v1/observation/event"),
            json=bad,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        assert ok.status_code == 200
        assert reject.status_code == 422

    def test_same_logical_pair_regular_vs_otc_isolated(self, api_client, base_url, observer_key):
        sid = _session_id()
        regular = "TESTONLY_EUR/USD"
        otc = "TESTONLY_EUR/USD (OTC)"
        pairs_payload = {
            "source": "MARKET_QX_BROWSER_OBSERVATION",
            "schema_version": 2,
            "session_id": sid,
            "dedupe_id": _dedupe("pair-otc"),
            "observationMethod": "visible-dom-only",
            "pairs": [
                {"symbol": regular, "providerSymbol": regular, "timeframe": "1m"},
                {"symbol": otc, "providerSymbol": otc, "timeframe": "1m"},
            ],
        }
        posted = api_client.post(
            _url(base_url, "/api/v1/observation/pairs"),
            json=pairs_payload,
            headers=_obs_headers(observer_key),
            timeout=25,
        )
        instruments = api_client.get(
            _url(base_url, "/api/v1/instruments?source=market-qx-observer-v2"), timeout=25
        )
        assert posted.status_code == 200
        assert instruments.status_code == 200
        symbols = {row.get("symbol") for row in instruments.json().get("items", [])}
        assert regular in symbols
        assert otc in symbols


class TestMongoLegacyIsolation:
    """Legacy import isolation checks via MongoDB."""

    def test_legacy_counts_and_training_eligibility(self, mongo_db):
        candle_count = mongo_db.legacy_candles_unverified.count_documents({})
        signal_count = mongo_db.legacy_signals_unverified.count_documents({})
        not_eligible = mongo_db.legacy_candles_unverified.count_documents({"trainingEligible": False})

        assert candle_count == 296
        assert signal_count == 2
        assert not_eligible == candle_count
