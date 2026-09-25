import { BinanceSpotProvider, DerivMarketDataProvider } from "./provider.js";
import { FinnhubForexProvider } from "./finnhub-provider.js";
import { OandaForexProvider } from "./oanda-provider.js";
class UnsupportedProviderAdapter {
    providerId;
    configured = false;
    sourceType = "BINARY_OPTIONS_SOURCE";
    dataIdentity;
    capabilities;
    constructor(providerId, providerType) {
        this.providerId = providerId;
        this.dataIdentity = providerId;
        this.capabilities = { historicalData: false, realtimeCandles: false, realtimeTicks: false, supportedInstruments: [], supportedTimeframes: [], sourceType: "BINARY_OPTIONS_SOURCE", providerType, authenticationRequired: true, availability: providerId === "quotex" ? "NOT_VERIFIED" : "NOT_SUPPORTED" };
    }
    async discoverInstruments() { return []; }
    async getSupportedTimeframes() { return []; }
    async fetchCandles(instrument, timeframe) { void instrument; void timeframe; return []; }
    async getHistoricalCandles(instrument, timeframe) { void instrument; void timeframe; return []; }
    async subscribeCandles(instrument, timeframe, onCandle) { void instrument; void timeframe; void onCandle; throw new Error("Provider does not expose a permitted live candle interface"); }
    async subscribeTicks(instrument, onTick) { void instrument; void onTick; throw new Error("Provider does not expose a permitted live tick interface"); }
    async healthcheck() { return { provider: this.name, available: false, status: this.providerId === "quotex" ? "NOT_VERIFIED" : "NOT_SUPPORTED", state: this.providerId === "quotex" ? "BLOCKED" : "NOT_CONFIGURED", latencyMs: null, freshnessSeconds: null, errorRate: 1, qualityScore: 0, lastChecked: new Date().toISOString() }; }
    async healthCheck() { return this.healthcheck(); }
    async reconnect() { throw new Error("Provider does not expose a permitted reconnect interface"); }
    async disconnect() { }
}
export class QuotexProviderAdapter extends UnsupportedProviderAdapter {
    name = "quotex";
    constructor() { super("quotex", "QUOTEX"); }
}
export class PocketOptionProviderAdapter extends UnsupportedProviderAdapter {
    name = "pocket-option";
    constructor() { super("pocket-option", "POCKET_OPTION"); }
}
export class AlimTradeProviderAdapter extends UnsupportedProviderAdapter {
    name = "alimtrade";
    constructor() { super("alimtrade", "ALIMTRADE"); }
}
export class OtherBinaryOptionsProviderAdapter extends UnsupportedProviderAdapter {
    name = "other-binary-options";
    constructor() { super("other-binary-options", "OTHER_BINARY_OPTIONS"); }
}
export class ProviderRegistry {
    providers = new Map();
    register(descriptor) {
        if (this.providers.has(descriptor.id))
            throw new Error(`Provider already registered: ${descriptor.id}`);
        this.providers.set(descriptor.id, descriptor);
    }
    get(id) { return this.providers.get(id); }
    list() { return [...this.providers.values()]; }
    async health() {
        return Promise.all(this.list().map(async (descriptor) => ({ ...await descriptor.adapter.healthcheck(), id: descriptor.id, dataIdentity: descriptor.dataIdentity, configured: descriptor.adapter.configured, category: descriptor.category, sourceType: descriptor.sourceType })));
    }
    static fromConfig(config) {
        const registry = new ProviderRegistry();
        const binance = BinanceSpotProvider.fromConfig(config);
        registry.register({ id: "binance", name: "Binance Spot", adapter: binance, dataIdentity: "binance-spot", category: "BINANCE_FOREX_REFERENCE", sourceType: "REFERENCE_MARKET_SOURCE" });
        const oanda = new OandaForexProvider(config);
        registry.register({ id: "oanda", name: "OANDA Forex", adapter: oanda, dataIdentity: "oanda-forex", category: "BINANCE_FOREX_REFERENCE", sourceType: "REFERENCE_MARKET_SOURCE" });
        const finnhub = new FinnhubForexProvider(config);
        registry.register({ id: "finnhub", name: "Finnhub Forex", adapter: finnhub, dataIdentity: "finnhub-forex", category: "FINNHUB_FOREX_REFERENCE", sourceType: "REFERENCE_MARKET_SOURCE" });
        const deriv = new DerivMarketDataProvider(config);
        registry.register({ id: "deriv", name: "Deriv Market Data", adapter: deriv, dataIdentity: "deriv-market-data", category: "DERIV_MARKET_DATA", sourceType: "REFERENCE_MARKET_SOURCE" });
        registry.register({ id: "quotex", name: "Quotex", adapter: new QuotexProviderAdapter(), dataIdentity: "quotex", category: "QUOTEX", sourceType: "BINARY_OPTIONS_SOURCE" });
        registry.register({ id: "pocket-option", name: "Pocket Option", adapter: new PocketOptionProviderAdapter(), dataIdentity: "pocket-option", category: "POCKET_OPTION", sourceType: "BINARY_OPTIONS_SOURCE" });
        registry.register({ id: "alimtrade", name: "AlimTrade", adapter: new AlimTradeProviderAdapter(), dataIdentity: "alimtrade", category: "ALIMTRADE", sourceType: "BINARY_OPTIONS_SOURCE" });
        registry.register({ id: "other-binary-options", name: "Other Binary Options", adapter: new OtherBinaryOptionsProviderAdapter(), dataIdentity: "other-binary-options", category: "OTHER_BINARY_OPTIONS", sourceType: "BINARY_OPTIONS_SOURCE" });
        return registry;
    }
}
