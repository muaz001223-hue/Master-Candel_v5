const DEFAULT_POLICY = {
    minimumScore: 85,
    expectedIntervalSeconds: { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 },
    maxFreshnessSeconds: 180,
};
export class DataQualityEngine {
    policy;
    constructor(policy = {}) {
        this.policy = { ...DEFAULT_POLICY, ...policy, expectedIntervalSeconds: { ...DEFAULT_POLICY.expectedIntervalSeconds, ...policy.expectedIntervalSeconds } };
    }
    evaluate(candles, now = new Date()) {
        const sorted = [...candles].sort((left, right) => left.openTimestamp.localeCompare(right.openTimestamp));
        const duplicates = sorted.length - new Set(sorted.map((candle) => candle.openTimestamp)).size;
        const orderingValid = candles.every((candle, index) => index === 0 || candles[index - 1].openTimestamp <= candle.openTimestamp);
        const timestampValid = sorted.every((candle) => new Date(candle.openTimestamp).getTime() < new Date(candle.closeTimestamp).getTime());
        const ohlcValid = sorted.every((candle) => candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) && candle.low <= candle.high);
        const missingValues = sorted.filter((candle) => [candle.open, candle.high, candle.low, candle.close].some((value) => !Number.isFinite(value))).length;
        const interval = sorted[0] ? this.policy.expectedIntervalSeconds[sorted[0].timeframe] : undefined;
        const gaps = interval === undefined ? 0 : sorted.slice(1).filter((candle, index) => (new Date(candle.openTimestamp).getTime() - new Date(sorted[index].openTimestamp).getTime()) / 1000 > interval * 1.5).length;
        const latest = sorted.at(-1);
        const freshnessSeconds = latest ? Math.max(0, (now.getTime() - new Date(latest.closeTimestamp).getTime()) / 1000) : null;
        const outliers = sorted.filter((candle) => Math.abs(candle.close - candle.open) > Math.max(Math.abs(candle.open) * 0.2, 1)).length;
        const reasons = [];
        if (duplicates > 0)
            reasons.push("DUPLICATES");
        if (!orderingValid)
            reasons.push("TIMESTAMP_ORDER");
        if (!timestampValid)
            reasons.push("INVALID_TIMESTAMP");
        if (!ohlcValid)
            reasons.push("INVALID_OHLC");
        if (missingValues > 0)
            reasons.push("MISSING_VALUES");
        if (gaps > 0)
            reasons.push("GAPS");
        if (outliers > 0)
            reasons.push("OUTLIERS");
        if (freshnessSeconds !== null && freshnessSeconds > this.policy.maxFreshnessSeconds)
            reasons.push("STALE_DATA");
        const deductions = duplicates * 15 + missingValues * 20 + gaps * 5 + outliers * 5 + (!orderingValid || !timestampValid || !ohlcValid ? 30 : 0);
        const score = Math.max(0, Math.min(100, 100 - deductions));
        return { score, status: sorted.length === 0 ? "UNVERIFIED" : score < this.policy.minimumScore ? "WARNING" : "VALID", timestamp: now.toISOString(), sampleSize: sorted.length, missingValues, duplicates, orderingValid, timestampValid, ohlcValid, gaps, outliers, freshnessSeconds, reasons };
    }
}
