export class OandaForexProvider {
    name = "oanda-forex";
    providerId = "OANDA";
    sourceType = "REFERENCE_MARKET_SOURCE";
    configured;
    capabilities;
    baseUrl;
    streamUrl;
    accountId;
    token;
    fetcher;
    constructor(config, fetcher = fetch) {
        this.baseUrl = config.oandaBaseUrl.replace(/\/$/, "");
        this.streamUrl = config.oandaStreamUrl.replace(/\/$/, "");
        this.accountId = config.oandaAccountId;
        this.token = config.oandaApiToken;
        this.configured = config.oandaEnabled && Boolean(this.accountId && this.token);
        this.fetcher = fetcher;
        this.capabilities = { historicalData: this.configured, realtimeCandles: false, realtimeTicks: this.configured, supportedInstruments: [], supportedTimeframes: ["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "4h", "1d"], sourceType: this.sourceType, providerType: "BINANCE_FOREX_REFERENCE", authenticationRequired: true, availability: this.configured ? "DISCONNECTED" : "NOT_CONFIGURED" };
    }
    async discoverInstruments() {
        const payload = await this.request(`/v3/accounts/${this.requiredAccount()}/instruments`);
        return (payload.instruments ?? []).filter((item) => item.type === "CURRENCY" && item.tradeable !== false).map((item) => {
            const [baseAsset, quoteAsset] = item.name.split("_");
            return { symbol: `${baseAsset}/${quoteAsset}`, baseAsset: baseAsset ?? item.name, quoteAsset: quoteAsset ?? "", provider: this.name, providerId: this.providerId, sourceType: this.sourceType, providerSymbol: item.name, supportedTimeframes: [...this.capabilities.supportedTimeframes], dataSource: "oanda-rest", timezone: "UTC", metadata: { displayName: item.displayName ?? item.name } };
        });
    }
    async getSupportedTimeframes() { return [...this.capabilities.supportedTimeframes]; }
    async fetchCandles(instrument, timeframe) {
        const granularity = this.toGranularity(timeframe);
        const payload = await this.request(`/v3/instruments/${encodeURIComponent(instrument.providerSymbol)}/candles?granularity=${granularity}&count=500&price=M`);
        const ingestionTimestamp = new Date().toISOString();
        return (payload.candles ?? []).filter((candle) => candle.complete && candle.mid).map((candle) => this.normalizeCandle(candle, instrument, timeframe, ingestionTimestamp));
    }
    async getHistoricalCandles(instrument, timeframe, startTime, endTime) {
        const granularity = this.toGranularity(timeframe);
        const query = `${startTime ? `&from=${encodeURIComponent(startTime)}` : ""}${endTime ? `&to=${encodeURIComponent(endTime)}` : ""}`;
        const payload = await this.request(`/v3/instruments/${encodeURIComponent(instrument.providerSymbol)}/candles?granularity=${granularity}&price=M${query}`);
        const ingestionTimestamp = new Date().toISOString();
        return (payload.candles ?? []).filter((candle) => candle.complete && candle.mid).map((candle) => this.normalizeCandle(candle, instrument, timeframe, ingestionTimestamp));
    }
    async subscribeCandles() { throw new Error("OANDA exposes pricing ticks; use subscribeTicks and build candles locally"); }
    async subscribeTicks(instrument, onTick) {
        const controller = new AbortController();
        const response = await this.fetcher(`${this.streamUrl}/v3/accounts/${this.requiredAccount()}/pricing/stream?instruments=${encodeURIComponent(instrument.providerSymbol)}`, { headers: this.headers(), signal: controller.signal });
        if (!response.ok || !response.body)
            throw new Error(`OANDA stream unavailable: ${response.status}`);
        void this.consumeStream(response.body, controller.signal, onTick);
        return () => controller.abort();
    }
    async healthcheck() {
        const started = Date.now();
        if (!this.configured)
            return this.health("NOT_CONFIGURED", started);
        try {
            await this.request(`/v3/accounts/${this.requiredAccount()}/instruments?count=1`);
            return this.health("CONNECTED", started);
        }
        catch {
            return this.health("DISCONNECTED", started);
        }
    }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { await this.healthcheck(); }
    async disconnect() { }
    async consumeStream(body, signal, onTick) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!signal.aborted) {
            const part = await reader.read();
            if (part.done)
                break;
            buffer += decoder.decode(part.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.trim())
                    continue;
                const message = JSON.parse(line);
                if (message.type !== "PRICE")
                    continue;
                const bid = Number(message.closeoutBid ?? message.bids?.[0]?.price);
                const ask = Number(message.closeoutAsk ?? message.asks?.[0]?.price);
                if (!Number.isFinite(bid) || !Number.isFinite(ask))
                    continue;
                await onTick({ price: (bid + ask) / 2, volume: null, sourceTimestamp: new Date(message.time).toISOString() });
            }
        }
    }
    normalizeCandle(candle, instrument, timeframe, ingestionTimestamp) { const mid = candle.mid; return { instrumentId: instrument.instrumentId, timeframe, open: Number(mid.o), high: Number(mid.h), low: Number(mid.l), close: Number(mid.c), volume: candle.volume ?? null, openTimestamp: new Date(candle.time).toISOString(), closeTimestamp: new Date(new Date(candle.time).getTime() + this.seconds(timeframe) * 1000).toISOString(), sourceTimestamp: new Date(candle.time).toISOString(), ingestionTimestamp, provider: this.name, providerId: this.providerId, providerSymbol: instrument.providerSymbol, sourceType: this.sourceType, dataQuality: "UNVERIFIED", qualityStatus: "UNVERIFIED", completenessStatus: "COMPLETE", sequenceNumber: null, state: "CLOSED" }; }
    async request(path) { if (!this.configured)
        throw new Error("OANDA provider not configured"); const response = await this.fetcher(`${this.baseUrl}${path}`, { headers: this.headers() }); if (!response.ok)
        throw new Error(`OANDA API ${response.status}`); return await response.json(); }
    headers() { return { Authorization: `Bearer ${this.requiredToken()}`, Accept: "application/json" }; }
    requiredAccount() { if (!this.accountId)
        throw new Error("OANDA_ACCOUNT_ID is required"); return this.accountId; }
    requiredToken() { if (!this.token)
        throw new Error("OANDA_API_TOKEN is required"); return this.token; }
    health(status, started) { return { provider: this.name, available: status === "CONNECTED", status, latencyMs: Date.now() - started, freshnessSeconds: status === "CONNECTED" ? 0 : null, errorRate: status === "CONNECTED" ? 0 : 1, qualityScore: status === "CONNECTED" ? 100 : 0, lastChecked: new Date().toISOString() }; }
    toGranularity(timeframe) { const map = { "1s": "S5", "5s": "S5", "10s": "S10", "15s": "S15", "30s": "S30", "1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "4h": "H4", "1d": "D" }; const value = map[timeframe]; if (!value)
        throw new Error(`Unsupported OANDA timeframe: ${timeframe}`); return value; }
    seconds(timeframe) { return Number(timeframe.endsWith("s") ? timeframe.slice(0, -1) : timeframe === "1m" ? 60 : timeframe === "5m" ? 300 : timeframe === "15m" ? 900 : timeframe === "30m" ? 1800 : timeframe === "1h" ? 3600 : timeframe === "4h" ? 14400 : 86400); }
}
