import math
from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass
class Candle:
    open: float
    high: float
    low: float
    close: float
    timestamp: str
    source: str = "UNVERIFIED_SCREEN_CAPTURE"


class AnomalyEngine:
    def __init__(self, spike_factor: float = 3.0, jump_threshold: float = 0.08, volatility_boost: float = 0.9):
        self.spike_factor = spike_factor
        self.jump_threshold = jump_threshold
        self.volatility_boost = volatility_boost
        self._recent_closes: deque[float] = deque(maxlen=5)

    def detect_spike_noise(self, candle: Candle) -> bool:
        body = abs(candle.close - candle.open)
        wick = max(abs(candle.high - candle.close), abs(candle.low - candle.close), abs(candle.high - candle.open), abs(candle.low - candle.open))
        if body <= 0:
            return False
        return wick >= (self.spike_factor * body)

    def detect_last_second_jump(self, candle: Candle) -> bool:
        if not self._recent_closes:
            self._recent_closes.append(candle.close)
            return False
        last = self._recent_closes[-1]
        self._recent_closes.append(candle.close)
        if last <= 0:
            return False
        return abs(candle.close - last) / last > self.jump_threshold

    def adjust_confidence(self, volatility_ratio: float, base_confidence: float) -> float:
        if volatility_ratio <= 0:
            return max(0.0, min(1.0, base_confidence))
        if volatility_ratio > 0.1:
            return max(0.0, min(1.0, base_confidence + (self.volatility_boost - base_confidence)))
        return max(0.0, min(1.0, base_confidence))

    def multi_timeframe_order_flow(self, m1: Candle, m5: Candle, m15: Candle) -> bool:
        if not all(isinstance(x, Candle) for x in (m1, m5, m15)):
            return False
        return (m1.close > m1.open and m5.close > m5.open and m15.close > m15.open) or (m1.close < m1.open and m5.close < m5.open and m15.close < m15.open)

    def evaluate(self, candle: Candle) -> dict[str, Any]:
        status = "VALID"
        if self.detect_spike_noise(candle):
            status = "ALGORITHMIC_NOISE"
        if self.detect_last_second_jump(candle):
            status = "FAKE_BREAKOUT"
        return {
            "status": status,
            "market_anomaly": self.detect_spike_noise(candle),
            "fake_breakout": self.detect_last_second_jump(candle),
            "confidence": self.adjust_confidence(0.12 if self.detect_last_second_jump(candle) else 0.05, 0.8),
        }
