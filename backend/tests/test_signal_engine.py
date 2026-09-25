"""Signal engine unit tests and live-signal API contract tests."""

from __future__ import annotations

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault('MARKET_TIMEFRAMES', '1s,5s,15s,1m,5m,10m,15m,30m,1h')

from signal_engine import evaluate, qualifies, outcome, MIN_CANDLES  # noqa: E402


def _series(seed: int, drift: float, count: int = 120, vol: float = 0.00015):
    rng = np.random.default_rng(seed)
    price, rows = 1.1, []
    for i in range(count):
        o = price
        c = o + drift + rng.normal(0, vol)
        rows.append({'open': o, 'high': max(o, c) + abs(rng.normal(0, 0.0001)), 'low': min(o, c) - abs(rng.normal(0, 0.0001)), 'close': c, 'epoch': i * 60})
        price = c
    return rows


class TestSignalEngine:
    def test_insufficient_history_is_no_signal(self):
        result = evaluate(_series(1, 0.0004, count=MIN_CANDLES - 1))
        assert result['direction'] == 'NO_SIGNAL'
        assert result['reason'] == 'INSUFFICIENT_CLOSED_CANDLES'

    def test_strong_uptrend_votes_call(self):
        result = evaluate(_series(1, 0.0004))
        assert result['direction'] == 'CALL'
        assert result['agreeCount'] >= 5
        assert result['opposeCount'] == 0
        assert 50 <= result['confidence'] <= 99

    def test_strong_downtrend_votes_put(self):
        result = evaluate(_series(3, -0.0004))
        assert result['direction'] == 'PUT'
        assert result['agreeCount'] >= 5

    def test_random_walk_does_not_qualify_at_default_threshold(self):
        for seed in range(2, 8):
            result = evaluate(_series(seed, 0.0))
            ok, _ = qualifies(result, 85)
            assert ok is False

    def test_higher_timeframe_conflict_penalises(self):
        base = _series(1, 0.0004)
        higher = _series(3, -0.0004, count=60)
        plain = evaluate(base)
        deep = evaluate(base, higher_timeframe_candles=higher, deep=True)
        assert deep['confidence'] < plain['confidence']
        assert any(p['name'] == 'HIGHER_TIMEFRAME_CONFLICT' for p in deep['penalties'])

    def test_outcome_rules(self):
        assert outcome('CALL', {'open': 1.0, 'close': 1.1}) == 'WIN'
        assert outcome('CALL', {'open': 1.0, 'close': 0.9}) == 'LOSS'
        assert outcome('PUT', {'open': 1.0, 'close': 0.9}) == 'WIN'
        assert outcome('PUT', {'open': 1.0, 'close': 1.0}) == 'TIE'


class TestSignalApi:
    def test_settings_roundtrip_and_validation(self, api_client, base_url):
        current = api_client.get(f'{base_url}/api/v1/signals/settings', timeout=20)
        assert current.status_code == 200
        original = current.json()['settings']['threshold']
        updated = api_client.post(f'{base_url}/api/v1/signals/settings', json={'threshold': 88}, timeout=20)
        assert updated.status_code == 200 and updated.json()['settings']['threshold'] == 88
        assert api_client.post(f'{base_url}/api/v1/signals/settings', json={'threshold': 20}, timeout=20).status_code == 422
        assert api_client.post(f'{base_url}/api/v1/signals/settings', json={'timeframes': ['2m']}, timeout=20).status_code == 422
        assert api_client.post(f'{base_url}/api/v1/signals/settings', json={}, timeout=20).status_code == 422
        restore = api_client.post(f'{base_url}/api/v1/signals/settings', json={'threshold': original}, timeout=20)
        assert restore.status_code == 200 and restore.json()['settings']['threshold'] == original

    def test_live_stats_history_shapes(self, api_client, base_url):
        live = api_client.get(f'{base_url}/api/v1/signals/live?source=all&limit=10', timeout=20)
        assert live.status_code == 200
        body = live.json()
        assert isinstance(body['upcoming'], list) and isinstance(body['recent'], list)
        assert 'engine' in body and 'settings' in body['engine']
        for signal in body['upcoming']:
            assert signal['direction'] in ('CALL', 'PUT')
            assert signal['expiryEpoch'] == signal['entryEpoch'] + signal['timeframeSeconds']
            assert signal['entryEpoch'] % signal['timeframeSeconds'] == 0
        stats = api_client.get(f'{base_url}/api/v1/signals/stats?hours=24', timeout=20)
        assert stats.status_code == 200
        assert stats.json()['measurement'] == 'ENTRY_CANDLE_OPEN_VS_CLOSE'
        assert api_client.get(f'{base_url}/api/v1/signals/history?limit=5&status=WIN', timeout=20).status_code == 200
        assert api_client.get(f'{base_url}/api/v1/signals/live?source=bogus', timeout=20).status_code == 422

    def test_check_reports_observer_and_engine(self, api_client, base_url):
        response = api_client.get(f'{base_url}/api/v1/signals/check', timeout=120)
        assert response.status_code == 200
        body = response.json()
        assert body['verdict'] in ('NOT_CONNECTED', 'RECEIVING', 'STALE', 'RECEIVING_WARMING_UP', 'RECEIVING_SIGNALS_ACTIVE')
        assert 'market-qx-observer-v2' in body['sources'] and 'deriv' in body['sources']
        assert body['engine']['settings']['threshold'] >= 55
