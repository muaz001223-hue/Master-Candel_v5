import { randomUUID } from "node:crypto";
export class RollingTickBuffer {
    capacity;
    ticks = [];
    constructor(capacity = 1000) {
        this.capacity = capacity;
    }
    push(tick) {
        const previous = this.ticks.at(-1);
        if (previous && (tick.sourceTimestamp < previous.sourceTimestamp || (tick.sourceTimestamp === previous.sourceTimestamp && tick.price === previous.price)))
            return;
        this.ticks.push(tick);
        if (this.ticks.length > this.capacity)
            this.ticks.splice(0, this.ticks.length - this.capacity);
    }
    latest(limit = this.capacity) { return this.ticks.slice(-limit); }
    clear() { this.ticks.length = 0; }
}
export class SecondCandleBuilder {
    instrument;
    provider;
    buckets = new Map();
    options;
    constructor(instrument, provider, options = {}) {
        this.instrument = instrument;
        this.provider = provider;
        this.options = { timeframeSeconds: options.timeframeSeconds ?? 1, now: options.now ?? Date.now };
    }
    add(tick) {
        if (!Number.isFinite(tick.price) || tick.price <= 0)
            return null;
        const sourceTime = new Date(tick.sourceTimestamp).getTime();
        if (!Number.isFinite(sourceTime) || sourceTime > this.options.now())
            return null;
        const bucketMs = this.options.timeframeSeconds * 1000;
        const bucket = Math.floor(sourceTime / bucketMs) * bucketMs;
        const existing = this.buckets.get(bucket) ?? [];
        if (existing.some((item) => item.sourceTimestamp === tick.sourceTimestamp && item.price === tick.price))
            return null;
        if (existing.length && sourceTime < new Date(existing[existing.length - 1].sourceTimestamp).getTime())
            return null;
        existing.push(tick);
        this.buckets.set(bucket, existing);
        return null;
    }
    close(timestamp = this.options.now()) {
        const bucketMs = this.options.timeframeSeconds * 1000;
        const closed = [];
        for (const [bucket, ticks] of this.buckets) {
            if (bucket + bucketMs > timestamp || ticks.length === 0)
                continue;
            const first = ticks[0];
            const last = ticks[ticks.length - 1];
            const prices = ticks.map((tick) => tick.price);
            const sourceType = this.instrument.sourceType;
            closed.push({
                instrumentId: this.instrument.instrumentId,
                timeframe: `${this.options.timeframeSeconds}s`,
                open: first.price,
                high: Math.max(...prices),
                low: Math.min(...prices),
                close: last.price,
                volume: ticks.reduce((sum, tick) => sum + (tick.volume ?? 0), 0) || null,
                openTimestamp: new Date(bucket).toISOString(),
                closeTimestamp: new Date(bucket + bucketMs).toISOString(),
                sourceTimestamp: last.sourceTimestamp,
                ingestionTimestamp: new Date(timestamp).toISOString(),
                provider: this.provider,
                providerId: first.providerId,
                providerSymbol: first.providerSymbol,
                ...(sourceType ? { sourceType } : {}),
                dataQuality: "UNVERIFIED",
                qualityStatus: "UNVERIFIED",
                completenessStatus: "COMPLETE",
                sequenceNumber: null,
                state: "CLOSED",
            });
            this.buckets.delete(bucket);
        }
        return closed;
    }
}
export function createTick(providerId, providerSymbol, instrument, price, sourceTimestamp, volume = null, ingestionTimestamp = new Date().toISOString()) {
    return { providerId, providerSymbol, instrumentId: instrument.instrumentId, sourceTimestamp, ingestionTimestamp, price, volume };
}
export function candleId(candle) { return `${candle.providerId}:${candle.providerSymbol}:${candle.instrumentId}:${candle.openTimestamp}:${randomUUID()}`; }
