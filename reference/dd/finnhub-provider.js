export class FinnhubForexProvider {
    name = "finnhub-forex";
    providerId = "FINNHUB";
    sourceType = "REFERENCE_MARKET_SOURCE";
    configured;
    capabilities;
    apiKey;
    baseUrl;
    websocketUrl;
    fetcher;
    constructor(config, fetcher = fetch) {
        this.apiKey = config.finnhubApiKey;
        this.baseUrl = config.finnhubBaseUrl.replace(/\/$/, "");
        this.websocketUrl = config.finnhubWebSocketUrl.replace(/\/$/, "");
        this.configured = config.finnhubEnabled && Boolean(this.apiKey);
        this.fetcher = fetcher;
        this.capabilities = {
            historicalData: this.configured,
            realtimeCandles: this.configured,
            realtimeTicks: this.configured,
            supportedInstruments: ["OANDA:EUR_USD", "OANDA:USD_JPY", "OANDA:GBP_USD", "OANDA:EUR_GBP", "BINANCE:BTCUSDT"],
            supportedTimeframes: ["1s", "5s", "1m"],
            sourceType: this.sourceType,
            providerType: "FINNHUB_FOREX_REFERENCE",
            authenticationRequired: true,
            availability: this.configured ? "DISCONNECTED" : "NOT_CONFIGURED",
        };
    }
    async discoverInstruments() {
        return [
            { symbol: "EUR/USD", baseAsset: "EUR", quoteAsset: "USD", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: "OANDA:EUR_USD", supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "finnhub-websocket", timezone: "UTC", metadata: { displayName: "EUR/USD" } },
            { symbol: "USD/JPY", baseAsset: "USD", quoteAsset: "JPY", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: "OANDA:USD_JPY", supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "finnhub-websocket", timezone: "UTC", metadata: { displayName: "USD/JPY" } },
            { symbol: "GBP/USD", baseAsset: "GBP", quoteAsset: "USD", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: "OANDA:GBP_USD", supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "finnhub-websocket", timezone: "UTC", metadata: { displayName: "GBP/USD" } },
            { symbol: "EUR/GBP", baseAsset: "EUR", quoteAsset: "GBP", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: "OANDA:EUR_GBP", supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "finnhub-websocket", timezone: "UTC", metadata: { displayName: "EUR/GBP" } },
            { symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: "BINANCE:BTCUSDT", supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "finnhub-websocket", timezone: "UTC", metadata: { displayName: "BTC/USDT" } },
        ];
    }
    async getSupportedTimeframes() { return [...this.capabilities.supportedTimeframes]; }
    async fetchCandles(instrument, timeframe) {
        const resolution = this.toResolution(timeframe);
        const now = Math.floor(Date.now() / 1000);
        const from = now - 60 * 60 * 24;
        const payload = await this.request(`/candle?symbol=${encodeURIComponent(instrument.providerSymbol)}&resolution=${resolution}&from=${from}&to=${now}`);
        if (payload.s !== "ok" || !payload.t || !payload.o || !payload.h || !payload.l || !payload.c) {
            return [];
        }
        const ingestionTimestamp = new Date().toISOString();
        return payload.t.map((timestamp, index) => ({
            instrumentId: instrument.instrumentId,
            timeframe,
            open: Number(payload.o?.[index] ?? 0),
            high: Number(payload.h?.[index] ?? 0),
            low: Number(payload.l?.[index] ?? 0),
            close: Number(payload.c?.[index] ?? 0),
            volume: Number(payload.v?.[index] ?? 0),
            openTimestamp: new Date(timestamp * 1000).toISOString(),
            closeTimestamp: new Date(timestamp * 1000).toISOString(),
            sourceTimestamp: new Date(timestamp * 1000).toISOString(),
            ingestionTimestamp,
            provider: this.name,
            providerId: this.providerId,
            providerSymbol: instrument.providerSymbol,
            sourceType: this.sourceType,
            dataQuality: "UNVERIFIED",
            qualityStatus: "UNVERIFIED",
            completenessStatus: "COMPLETE",
            sequenceNumber: null,
            state: "CLOSED",
        }));
    }
    async getHistoricalCandles(instrument, timeframe, startTime, endTime) {
        const resolution = this.toResolution(timeframe);
        const to = endTime ? Math.floor(Date.parse(endTime) / 1000) : Math.floor(Date.now() / 1000);
        const from = startTime ? Math.floor(Date.parse(startTime) / 1000) : to - 60 * 60 * 24;
        const payload = await this.request(`/candle?symbol=${encodeURIComponent(instrument.providerSymbol)}&resolution=${resolution}&from=${from}&to=${to}`);
        if (payload.s !== "ok" || !payload.t || !payload.o || !payload.h || !payload.l || !payload.c)
            return [];
        const ingestionTimestamp = new Date().toISOString();
        return payload.t.map((timestamp, index) => ({
            instrumentId: instrument.instrumentId,
            timeframe,
            open: Number(payload.o?.[index] ?? 0),
            high: Number(payload.h?.[index] ?? 0),
            low: Number(payload.l?.[index] ?? 0),
            close: Number(payload.c?.[index] ?? 0),
            volume: Number(payload.v?.[index] ?? 0),
            openTimestamp: new Date(timestamp * 1000).toISOString(),
            closeTimestamp: new Date(timestamp * 1000).toISOString(),
            sourceTimestamp: new Date(timestamp * 1000).toISOString(),
            ingestionTimestamp,
            provider: this.name,
            providerId: this.providerId,
            providerSymbol: instrument.providerSymbol,
            sourceType: this.sourceType,
            dataQuality: "UNVERIFIED",
            qualityStatus: "UNVERIFIED",
            completenessStatus: "COMPLETE",
            sequenceNumber: null,
            state: "CLOSED",
        }));
    }
    async subscribeCandles(instrument, timeframe, onCandle) {
        const bucketState = new Map();
        const forceFlush = async (bucket, finishedAt) => {
            const candle = {
                instrumentId: instrument.instrumentId,
                timeframe,
                open: bucket.open,
                high: bucket.high,
                low: bucket.low,
                close: bucket.close,
                volume: bucket.volume,
                openTimestamp: new Date(bucket.start).toISOString(),
                closeTimestamp: new Date(finishedAt).toISOString(),
                sourceTimestamp: new Date(finishedAt).toISOString(),
                ingestionTimestamp: new Date().toISOString(),
                provider: this.name,
                providerId: this.providerId,
                providerSymbol: instrument.providerSymbol,
                sourceType: this.sourceType,
                dataQuality: "UNVERIFIED",
                qualityStatus: "UNVERIFIED",
                completenessStatus: "COMPLETE",
                sequenceNumber: null,
                state: "CLOSED",
            };
            await onCandle(candle);
        };
        const canEmit = (tickTime, bucketTime) => tickTime >= bucketTime + this.toMilliseconds(timeframe);
        const unsubscribe = await this.subscribeTicks(instrument, async (tick) => {
            const bucketKey = Math.floor(Date.parse(tick.sourceTimestamp) / this.toMilliseconds(timeframe)) * this.toMilliseconds(timeframe);
            const existing = bucketState.get(bucketKey);
            if (!existing) {
                bucketState.set(bucketKey, { open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.volume ?? 1, start: bucketKey, end: bucketKey + this.toMilliseconds(timeframe) });
                return;
            }
            existing.high = Math.max(existing.high, tick.price);
            existing.low = Math.min(existing.low, tick.price);
            existing.close = tick.price;
            existing.volume += tick.volume ?? 1;
            const now = Date.parse(tick.sourceTimestamp);
            if (canEmit(now, bucketKey)) {
                const bucket = bucketState.get(bucketKey);
                bucketState.delete(bucketKey);
                await forceFlush(bucket, bucket.end);
            }
        });
        return unsubscribe;
    }
    async subscribeTicks(instrument, onTick) {
        if (!this.configured)
            throw new Error("Finnhub provider not configured");
        const socket = new WebSocket(`${this.websocketUrl}?token=${encodeURIComponent(this.requiredApiKey())}`);
        return await new Promise((resolve, reject) => {
            socket.onopen = () => {
                socket.send(JSON.stringify({ type: "subscribe", symbol: instrument.providerSymbol }));
                socket.onmessage = (event) => {
                    const text = typeof event.data === "string" ? event.data : String(event.data);
                    const message = JSON.parse(text);
                    const trade = message.data?.[0];
                    if (!trade || typeof trade.p !== "number" || typeof trade.t !== "number")
                        return;
                    void onTick({ price: Number(trade.p), volume: typeof trade.v === "number" ? Number(trade.v) : null, sourceTimestamp: new Date(trade.t).toISOString() });
                };
                socket.onerror = () => reject(new Error("Finnhub websocket connection failed"));
                resolve(() => socket.close());
            };
            socket.onerror = (error) => {
                reject(error instanceof Error ? error : new Error("Finnhub websocket connection failed"));
            };
        });
    }
    async healthcheck() {
        const started = Date.now();
        if (!this.configured) {
            return { provider: this.name, available: false, status: "NOT_CONFIGURED", latencyMs: null, freshnessSeconds: null, errorRate: 1, qualityScore: 0, lastChecked: new Date().toISOString() };
        }
        try {
            await this.request(`/quote?symbol=${encodeURIComponent("OANDA:EUR_USD")}`);
            return { provider: this.name, available: true, status: "CONNECTED", latencyMs: Date.now() - started, freshnessSeconds: 0, errorRate: 0, qualityScore: 100, lastChecked: new Date().toISOString() };
        }
        catch {
            return { provider: this.name, available: false, status: "DISCONNECTED", latencyMs: Date.now() - started, freshnessSeconds: null, errorRate: 1, qualityScore: 0, lastChecked: new Date().toISOString() };
        }
    }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { await this.healthcheck(); }
    async disconnect() { }
    async request(path) {
        if (!this.configured)
            throw new Error("Finnhub provider not configured");
        const response = await this.fetcher(`${this.baseUrl}${path}&token=${encodeURIComponent(this.requiredApiKey())}`);
        if (!response.ok)
            throw new Error(`Finnhub API ${response.status}`);
        return await response.json();
    }
    requiredApiKey() {
        if (!this.apiKey)
            throw new Error("FINNHUB_API_KEY is required");
        return this.apiKey;
    }
    toResolution(timeframe) {
        const map = { "1s": "1", "5s": "5", "10s": "10", "15s": "15", "30s": "30", "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };
        const value = map[timeframe];
        if (!value)
            throw new Error(`Unsupported Finnhub timeframe: ${timeframe}`);
        return value;
    }
    toMilliseconds(timeframe) {
        if (timeframe.endsWith("ms"))
            return Number(timeframe.slice(0, -2));
        const map = { "1s": 1000, "5s": 5000, "10s": 10000, "15s": 15000, "30s": 30000, "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
        return map[timeframe] ?? 1000;
    }
}
