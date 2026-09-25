export class ProviderDataCollector {
    provider;
    store;
    quality;
    events;
    options;
    lastOpenTimestamp = new Map();
    liveStop = null;
    liveTimer = null;
    state = { connected: false, reconnects: 0, lastEventAt: null, lastError: null };
    constructor(provider, store, quality, events, options = {}) {
        this.provider = provider;
        this.store = store;
        this.quality = quality;
        this.events = events;
        this.options = {
            maxAttempts: options.maxAttempts ?? 3,
            retryBaseMs: options.retryBaseMs ?? 100,
            heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 30_000,
            now: options.now ?? Date.now,
        };
    }
    async backfill(instrument, timeframe) {
        const incoming = await this.withRetry(() => this.provider.fetchCandles(instrument, timeframe));
        const normalized = incoming.map((candle) => this.normalize(candle, instrument, timeframe));
        const valid = normalized.filter((candle) => this.isUsable(candle));
        const skipped = normalized.length - valid.length;
        const ordered = [...valid].sort((left, right) => left.openTimestamp.localeCompare(right.openTimestamp));
        const stored = [];
        for (const candle of ordered) {
            const previous = this.store.list(instrument.instrumentId, timeframe).find((item) => item.openTimestamp === candle.openTimestamp);
            const result = this.store.upsert(candle);
            if (!previous || result.version !== previous.version)
                stored.push(result);
        }
        const quality = this.quality.evaluate(this.store.list(instrument.instrumentId, timeframe), new Date(this.options.now()));
        if (quality.gaps > 0)
            this.events.emit({ eventType: "DATA_GAP", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { gaps: quality.gaps } });
        return { candles: stored, quality, skipped, outOfOrder: 0, duplicates: ordered.length - stored.length };
    }
    async startLive(instrument, timeframe) {
        if (!this.provider.subscribeCandles && !this.provider.streamCandles)
            throw new Error(`Live stream not supported by provider: ${this.provider.name}`);
        let active = true;
        const connect = async () => {
            if (!active || (!this.provider.subscribeCandles && !this.provider.streamCandles))
                return;
            try {
                const subscribe = this.provider.subscribeCandles ?? this.provider.streamCandles;
                this.liveStop = await subscribe.call(this.provider, instrument, timeframe, async (raw) => {
                    this.state.lastEventAt = new Date(this.options.now()).toISOString();
                    await this.acceptLive(raw, instrument, timeframe);
                });
                this.state.connected = true;
                this.state.lastError = null;
                this.events.emit({ eventType: "MARKET_CONNECTED", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { providerId: rawProviderId(this.provider) } });
            }
            catch (error) {
                this.state.connected = false;
                this.state.reconnects += 1;
                this.state.lastError = error instanceof Error ? error.message : "stream connection failed";
                this.events.emit({ eventType: "PROVIDER_FAILURE", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { error: this.state.lastError, reconnect: true } });
                if (active)
                    setTimeout(() => { void connect(); }, this.options.retryBaseMs * 2 ** Math.min(this.state.reconnects, 6));
            }
        };
        await connect();
        this.liveTimer = setInterval(() => {
            if (!active || !this.state.lastEventAt)
                return;
            if (this.options.now() - new Date(this.state.lastEventAt).getTime() > this.options.heartbeatTimeoutMs) {
                this.state.connected = false;
                this.state.lastError = "stream heartbeat timeout";
                this.events.emit({ eventType: "DATA_DELAY", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { timeoutMs: this.options.heartbeatTimeoutMs } });
                this.liveStop?.();
                this.liveStop = null;
                this.state.reconnects += 1;
                void connect();
            }
        }, Math.max(50, Math.floor(this.options.heartbeatTimeoutMs / 2)));
        return () => {
            active = false;
            this.state.connected = false;
            this.liveStop?.();
            this.liveStop = null;
            if (this.liveTimer)
                clearInterval(this.liveTimer);
            this.liveTimer = null;
        };
    }
    async acceptLive(raw, instrument, timeframe) {
        const candle = this.normalize(raw, instrument, timeframe);
        if (!this.isUsable(candle))
            return;
        const key = `${instrument.instrumentId}:${timeframe}`;
        const openTime = new Date(candle.openTimestamp).getTime();
        const last = this.lastOpenTimestamp.get(key);
        if (last !== undefined && openTime < last) {
            this.events.emit({ eventType: "DATA_DELAY", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { openTimestamp: candle.openTimestamp, lastOpenTimestamp: new Date(last).toISOString() } });
            return;
        }
        this.lastOpenTimestamp.set(key, Math.max(last ?? openTime, openTime));
        const stored = this.store.upsert(candle);
        this.events.emit({ eventType: stored.state === "CLOSED" ? "CANDLE_CLOSED" : "CANDLE_UPDATED", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { candleId: stored.candleId, version: stored.version, providerId: stored.providerId } });
    }
    normalize(input, instrument, timeframe) {
        const sourceType = input.sourceType ?? instrument.sourceType ?? this.provider.sourceType;
        return { ...input, instrumentId: instrument.instrumentId, timeframe, provider: input.provider || this.provider.name, providerId: input.providerId ?? instrument.providerId ?? this.provider.providerId ?? this.provider.name, providerSymbol: input.providerSymbol ?? instrument.providerSymbol, ...(sourceType ? { sourceType } : {}), ingestionTimestamp: input.ingestionTimestamp || new Date(this.options.now()).toISOString() };
    }
    isUsable(candle) {
        const now = this.options.now();
        const open = new Date(candle.openTimestamp).getTime();
        const close = new Date(candle.closeTimestamp).getTime();
        return Number.isFinite(open) && Number.isFinite(close) && close > open && close <= now && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
    }
    async withRetry(operation) {
        let lastError;
        for (let attempt = 0; attempt < this.options.maxAttempts; attempt += 1) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                if (attempt + 1 < this.options.maxAttempts)
                    await new Promise((resolve) => setTimeout(resolve, this.options.retryBaseMs * 2 ** attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new Error("provider operation failed");
    }
}
function rawProviderId(provider) {
    return provider.providerId ?? provider.name;
}
