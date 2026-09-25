export class BinanceSpotProvider {
    name = "binance-spot";
    providerId = "BINANCE";
    sourceType = "REFERENCE_MARKET_SOURCE";
    configured = true;
    capabilities = { historicalData: true, realtimeCandles: true, realtimeTicks: false, supportedInstruments: [], supportedTimeframes: ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"], sourceType: "REFERENCE_MARKET_SOURCE", providerType: "BINANCE_FOREX_REFERENCE", authenticationRequired: false, availability: "CONNECTED" };
    baseUrl;
    fetcher;
    timeoutMs;
    quoteAssets;
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl ?? "https://api.binance.com").replace(/\/$/, "");
        this.fetcher = options.fetcher ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 5_000;
        this.quoteAssets = new Set(options.quoteAssets ?? ["USDT", "USDC", "BTC", "ETH"]);
    }
    static fromConfig(config) {
        return config.binanceEnabled ? new BinanceSpotProvider({ baseUrl: config.binanceBaseUrl }) : new UnconfiguredProvider("binance-spot");
    }
    async discoverInstruments() {
        const payload = await this.request("/api/v3/exchangeInfo");
        return (payload.symbols ?? []).filter((item) => item.status === "TRADING" && item.isSpotTradingAllowed !== false && this.quoteAssets.has(item.quoteAsset)).map((item) => ({
            symbol: `${item.baseAsset}/${item.quoteAsset}`,
            baseAsset: item.baseAsset,
            quoteAsset: item.quoteAsset,
            provider: this.name,
            providerId: this.providerId,
            sourceType: this.sourceType,
            providerSymbol: item.symbol,
            supportedTimeframes: ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"],
            dataSource: "binance-spot-rest",
            timezone: "UTC",
            metadata: { exchangeStatus: item.status },
        }));
    }
    async getSupportedTimeframes() { return [...this.capabilities.supportedTimeframes]; }
    async fetchCandles(instrument, timeframe) {
        return this.fetchCandlesWithQuery(instrument, timeframe, "&limit=100");
    }
    async fetchCandlesWithQuery(instrument, timeframe, query) {
        if (!instrument.supportedTimeframes.includes(timeframe))
            throw new Error(`Unsupported timeframe: ${timeframe}`);
        const klines = await this.request(`/api/v3/klines?symbol=${encodeURIComponent(instrument.providerSymbol)}&interval=${encodeURIComponent(timeframe)}${query}`);
        const ingestionTimestamp = new Date().toISOString();
        const now = Date.now();
        return klines.filter((kline) => kline[6] <= now).map((kline) => ({
            instrumentId: instrument.instrumentId,
            timeframe,
            open: Number(kline[1]),
            high: Number(kline[2]),
            low: Number(kline[3]),
            close: Number(kline[4]),
            volume: Number(kline[5]),
            openTimestamp: new Date(kline[0]).toISOString(),
            closeTimestamp: new Date(kline[6]).toISOString(),
            sourceTimestamp: new Date(kline[6]).toISOString(),
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
        const range = `${startTime ? `&startTime=${Date.parse(startTime)}` : ""}${endTime ? `&endTime=${Date.parse(endTime)}` : ""}`;
        return this.fetchCandlesWithQuery(instrument, timeframe, range);
    }
    async subscribeCandles(instrument, timeframe, onCandle) { return this.streamCandles(instrument, timeframe, onCandle); }
    async subscribeTicks(instrument, onTick) { void instrument; void onTick; throw new Error("Binance tick subscription is not implemented by this adapter"); }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { await this.healthcheck(); }
    async disconnect() { }
    async healthcheck() {
        const started = Date.now();
        try {
            await this.request("/api/v3/time");
            return { provider: this.name, available: true, status: "CONNECTED", latencyMs: Date.now() - started, freshnessSeconds: 0, errorRate: 0, qualityScore: 100, lastChecked: new Date().toISOString() };
        }
        catch {
            return { provider: this.name, available: false, status: "DISCONNECTED", latencyMs: Date.now() - started, freshnessSeconds: null, errorRate: 1, qualityScore: 0, lastChecked: new Date().toISOString() };
        }
    }
    async streamCandles(instrument, timeframe, onCandle) {
        const socket = new WebSocket(`wss://stream.binance.com:9443/ws/${instrument.providerSymbol.toLowerCase()}@kline_${timeframe}`);
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            const kline = message.k;
            if (!kline)
                return;
            const candle = { instrumentId: instrument.instrumentId, timeframe, open: Number(kline.o), high: Number(kline.h), low: Number(kline.l), close: Number(kline.c), volume: Number(kline.v), openTimestamp: new Date(kline.t).toISOString(), closeTimestamp: new Date(kline.T).toISOString(), sourceTimestamp: new Date(kline.T).toISOString(), ingestionTimestamp: new Date().toISOString(), provider: this.name, providerId: this.providerId, providerSymbol: instrument.providerSymbol, sourceType: this.sourceType, dataQuality: "UNVERIFIED", qualityStatus: "UNVERIFIED", completenessStatus: kline.x ? "COMPLETE" : "PARTIAL", sequenceNumber: null, state: kline.x ? "CLOSED" : "UPDATED" };
            void onCandle(candle);
        };
        await new Promise((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("provider websocket connection failed")); });
        return () => socket.close();
    }
    async request(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetcher(`${this.baseUrl}${path}`, { signal: controller.signal });
            if (response.status === 429)
                throw new Error("provider rate limit");
            if (!response.ok)
                throw new Error(`provider http ${response.status}`);
            return await response.json();
        }
        finally {
            clearTimeout(timer);
        }
    }
}
export function distributeDerivSymbols(symbols, connectionCount) {
    const cleaned = Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean)));
    const safeConnectionCount = Math.max(1, connectionCount);
    const groups = Array.from({ length: safeConnectionCount }, () => []);
    if (cleaned.length === 0)
        return groups;
    let offset = 0;
    for (let groupIndex = 0; groupIndex < safeConnectionCount; groupIndex += 1) {
        const remaining = cleaned.length - offset;
        const chunkSize = Math.max(1, Math.ceil(remaining / (safeConnectionCount - groupIndex)));
        const nextOffset = Math.min(offset + chunkSize, cleaned.length);
        groups[groupIndex] = cleaned.slice(offset, nextOffset);
        offset = nextOffset;
    }
    return groups;
}
export class DerivMarketDataProvider {
    name = "deriv";
    providerId = "DERIV";
    sourceType = "REFERENCE_MARKET_SOURCE";
    configured;
    capabilities;
    appId;
    apiToken;
    wsUrl;
    symbolSet;
    connectionTokens;
    connectionCount;
    constructor(config) {
        this.appId = config.derivAppId ?? "1089";
        this.apiToken = config.derivApiToken ?? null;
        this.wsUrl = (config.derivWsUrl || "wss://ws.binaryws.com/websockets/v3").replace(/\/$/, "");
        this.symbolSet = config.derivSymbols.length > 0 ? Array.from(new Set(config.derivSymbols.map((symbol) => symbol.trim()).filter(Boolean))) : ["R_10", "R_50"];
        const tokenSet = (config.derivTokens ?? []).map((token) => token.trim()).filter((token) => Boolean(token));
        this.connectionTokens = tokenSet.length > 0 ? tokenSet : this.apiToken ? [this.apiToken] : [];
        this.connectionCount = Math.max(1, this.connectionTokens.length || 1);
        this.configured = Boolean(config.derivEnabled && (this.apiToken || this.connectionTokens.length > 0));
        this.capabilities = {
            historicalData: this.configured,
            realtimeCandles: this.configured,
            realtimeTicks: this.configured,
            supportedInstruments: this.symbolSet,
            supportedTimeframes: ["1m", "5m", "15m", "30m", "1h"],
            sourceType: this.sourceType,
            providerType: "DERIV_MARKET_DATA",
            authenticationRequired: true,
            availability: this.configured ? "CONNECTED" : "NOT_CONFIGURED",
        };
    }
    async discoverInstruments() {
        return this.symbolSet.map((symbol) => ({
            symbol: symbol.startsWith("frx") ? symbol.replace(/^frx/, "") : symbol,
            baseAsset: symbol.startsWith("frx") ? symbol.slice(3, 6) : symbol,
            quoteAsset: symbol.startsWith("frx") ? symbol.slice(6) : "INDEX",
            provider: this.name,
            providerId: this.providerId,
            sourceType: this.sourceType,
            providerSymbol: symbol,
            supportedTimeframes: [...this.capabilities.supportedTimeframes],
            dataSource: "deriv-websocket",
            timezone: "UTC",
            metadata: { displayName: symbol },
        }));
    }
    async getSupportedTimeframes() { return [...this.capabilities.supportedTimeframes]; }
    async fetchCandles() { return []; }
    async getHistoricalCandles() { return []; }
    async subscribeCandles(instrument, timeframe, onCandle) {
        if (!this.configured)
            throw new Error("Deriv provider not configured");
        const groups = distributeDerivSymbols(this.symbolSet, this.connectionCount);
        const targetGroup = groups.find((group) => group.includes(instrument.providerSymbol)) ?? groups[0] ?? [];
        const token = this.connectionTokens[groups.indexOf(targetGroup)] ?? this.apiToken ?? this.connectionTokens[0] ?? null;
        const socket = this.openSocket(token);
        const granularity = this.toGranularity(timeframe);
        let authorized = false;
        let subscribed = false;
        const trySubscribe = () => {
            if (!authorized || subscribed)
                return;
            subscribed = true;
            socket.send(JSON.stringify({ ticks_history: instrument.providerSymbol, style: "candles", granularity }));
        };
        socket.onmessage = (event) => {
            const payload = JSON.parse(event.data);
            if (payload.msg_type === "authorize") {
                const authorize = payload.authorize;
                if (authorize && (authorize.status === 1 || authorize.loginid)) {
                    authorized = true;
                    trySubscribe();
                }
                return;
            }
            if (payload.msg_type === "error")
                return;
            const candles = payload.candles;
            if (!candles || !Array.isArray(candles) || candles.length === 0)
                return;
            for (const candle of candles) {
                const open = Number(candle.open);
                const high = Number(candle.high);
                const low = Number(candle.low);
                const close = Number(candle.close);
                if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close))
                    continue;
                const item = {
                    instrumentId: instrument.instrumentId,
                    timeframe,
                    open,
                    high,
                    low,
                    close,
                    volume: Number(candle.volume ?? 0),
                    openTimestamp: new Date(Number(candle.epoch ?? 0) * 1000).toISOString(),
                    closeTimestamp: new Date(Number(candle.epoch ?? 0) * 1000).toISOString(),
                    sourceTimestamp: new Date(Number(candle.epoch ?? 0) * 1000).toISOString(),
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
                void onCandle(item);
            }
        };
        socket.onopen = () => {
            if (token) {
                socket.send(JSON.stringify({ authorize: token }));
                return;
            }
            authorized = true;
            trySubscribe();
        };
        return () => socket.close();
    }
    async subscribeTicks(instrument, onTick) {
        if (!this.configured)
            throw new Error("Deriv provider not configured");
        const groups = distributeDerivSymbols(this.symbolSet, this.connectionCount);
        const targetGroup = groups.find((group) => group.includes(instrument.providerSymbol)) ?? groups[0] ?? [];
        const token = this.connectionTokens[groups.indexOf(targetGroup)] ?? this.apiToken ?? this.connectionTokens[0] ?? null;
        const socket = this.openSocket(token);
        let authorized = false;
        let subscribed = false;
        const trySubscribe = () => {
            if (!authorized || subscribed)
                return;
            subscribed = true;
            socket.send(JSON.stringify({ ticks: instrument.providerSymbol }));
        };
        socket.onopen = () => {
            if (token) {
                socket.send(JSON.stringify({ authorize: token }));
                return;
            }
            authorized = true;
            trySubscribe();
        };
        socket.onmessage = (event) => {
            const payload = JSON.parse(event.data);
            if (payload.msg_type === "authorize") {
                const authorize = payload.authorize;
                if (authorize && (authorize.status === 1 || authorize.loginid)) {
                    authorized = true;
                    trySubscribe();
                }
                return;
            }
            if (payload.msg_type === "error")
                return;
            const tick = payload.tick;
            if (!tick || typeof tick.symbol !== "string")
                return;
            const candidate = Number(tick.quote ?? tick.bid ?? tick.ask ?? 0);
            if (!Number.isFinite(candidate))
                return;
            void onTick({ price: candidate, volume: null, sourceTimestamp: new Date((Number(tick.epoch ?? Date.now() / 1000)) * 1000).toISOString() });
        };
        return () => socket.close();
    }
    async healthcheck() {
        const available = this.configured && Boolean(this.apiToken) && Boolean(this.appId);
        return { provider: this.name, available, status: available ? "CONNECTED" : "NOT_CONFIGURED", state: available ? "CONNECTED" : "NOT_CONFIGURED", latencyMs: null, freshnessSeconds: null, errorRate: available ? 0 : 1, qualityScore: available ? 100 : 0, lastChecked: new Date().toISOString() };
    }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { return; }
    async disconnect() { }
    openSocket(token = this.apiToken) {
        const baseUrl = this.wsUrl.includes("?") ? this.wsUrl : `${this.wsUrl}?app_id=${encodeURIComponent(this.appId)}`;
        const socket = new WebSocket(baseUrl);
        socket.onerror = () => {
            /* noop: caller may attach explicit onerror handlers */
        };
        void token;
        return socket;
    }
    toGranularity(timeframe) {
        const map = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600 };
        return map[timeframe] ?? 60;
    }
}
export class UnconfiguredProvider {
    name;
    configured = false;
    sourceType = "BINARY_OPTIONS_SOURCE";
    providerId = "UNCONFIGURED";
    capabilities = { historicalData: false, realtimeCandles: false, realtimeTicks: false, supportedInstruments: [], supportedTimeframes: [], sourceType: this.sourceType, providerType: "BINANCE_FOREX_REFERENCE", authenticationRequired: true, availability: "NOT_CONFIGURED" };
    constructor(name) {
        this.name = name;
    }
    async discoverInstruments() { return []; }
    async getSupportedTimeframes() { return []; }
    async fetchCandles() { return []; }
    async getHistoricalCandles() { return []; }
    async subscribeCandles() { throw new Error("Provider is not configured"); }
    async subscribeTicks() { throw new Error("Provider is not configured"); }
    async healthcheck() { return { provider: this.name, available: false, status: "NOT_CONFIGURED", latencyMs: null, freshnessSeconds: null, errorRate: 1, qualityScore: 0, lastChecked: new Date().toISOString() }; }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { throw new Error("Provider is not configured"); }
    async disconnect() { }
}
export class ProviderFailover {
    providers;
    constructor(providers) {
        this.providers = providers;
    }
    async discover() {
        for (const provider of this.providers) {
            if (!provider.configured)
                continue;
            const health = await provider.healthcheck();
            if (!health.available)
                continue;
            const instruments = await provider.discoverInstruments();
            return { provider: provider.name, instruments };
        }
        return null;
    }
}
