export class FeatureEngine {
    featureVersion;
    constructor(featureVersion = "features-1.0.0") {
        this.featureVersion = featureVersion;
    }
    compute(candles, asOfTimestamp) {
        const available = candles.filter((candle) => !asOfTimestamp || candle.closeTimestamp <= asOfTimestamp).sort((left, right) => left.closeTimestamp.localeCompare(right.closeTimestamp));
        const current = available.at(-1);
        const previous = available.at(-2);
        if (!current)
            return { featureVersion: this.featureVersion, instrumentId: "", timeframe: "", asOfTimestamp: asOfTimestamp ?? new Date(0).toISOString(), returns: null, rollingReturn: null, range: null, body: null, bodyRatio: null, upperWick: null, lowerWick: null, volatility: null, momentum: null };
        const range = current.high - current.low;
        const body = current.close - current.open;
        const returns = previous && previous.close !== 0 ? current.close / previous.close - 1 : null;
        const recent = available.slice(-5);
        const recentReturns = recent.slice(1).map((candle, index) => recent[index].close === 0 ? 0 : candle.close / recent[index].close - 1);
        const mean = recentReturns.length ? recentReturns.reduce((sum, value) => sum + value, 0) / recentReturns.length : null;
        const variance = mean === null ? null : recentReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recentReturns.length;
        return { featureVersion: this.featureVersion, instrumentId: current.instrumentId, timeframe: current.timeframe, asOfTimestamp: current.closeTimestamp, returns, rollingReturn: previous && previous.close !== 0 ? current.close / previous.close - 1 : null, range, body, bodyRatio: range === 0 ? null : body / range, upperWick: current.high - Math.max(current.open, current.close), lowerWick: Math.min(current.open, current.close) - current.low, volatility: variance === null ? null : Math.sqrt(variance), momentum: mean };
    }
    computeTicks(ticks) {
        const ordered = [...ticks].sort((left, right) => left.sourceTimestamp.localeCompare(right.sourceTimestamp));
        const deltas = ordered.slice(1).map((tick, index) => {
            const previous = ordered[index];
            return previous.price === 0 ? 0 : tick.price / previous.price - 1;
        });
        const recent = deltas.slice(-20);
        const last = ordered.at(-1);
        const previous = ordered.at(-2);
        const tickDelta = last && previous ? last.price - previous.price : null;
        const velocity = recent.length ? recent.slice(-5).reduce((sum, value) => sum + value, 0) / Math.min(5, recent.length) : null;
        const microTrend = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null;
        const priorVelocity = recent.length > 5 ? recent.slice(0, -5).reduce((sum, value) => sum + value, 0) / (recent.length - 5) : null;
        const acceleration = velocity !== null && priorVelocity !== null ? velocity - priorVelocity : null;
        const mean = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null;
        const volatility = mean === null ? null : Math.sqrt(recent.reduce((sum, value) => sum + (value - mean) ** 2, 0) / recent.length);
        const first = ordered.at(-Math.min(20, ordered.length));
        const durationSeconds = first && last ? Math.max((Date.parse(last.sourceTimestamp) - Date.parse(first.sourceTimestamp)) / 1000, 0.001) : null;
        const direction = recent.map((value) => Math.sign(value)).filter((value) => value !== 0);
        const lastDirection = direction.at(-1) ?? 0;
        let consecutiveDirection = 0;
        for (let index = direction.length - 1; index >= 0 && direction[index] === lastDirection; index -= 1)
            consecutiveDirection += 1;
        return {
            featureVersion: `${this.featureVersion}:ticks`, symbol: last?.providerSymbol ?? "", asOfTimestamp: last?.sourceTimestamp ?? new Date(0).toISOString(),
            sampleSize: ordered.length, lastPrice: last?.price ?? null, tickDelta, velocity, microTrend, acceleration, volatility,
            frequencyPerSecond: durationSeconds === null ? null : Math.max(0, (ordered.length - 1) / durationSeconds), consecutiveDirection: lastDirection * consecutiveDirection,
        };
    }
}
