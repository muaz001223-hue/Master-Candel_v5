import { randomUUID } from "node:crypto";
import { BinarySignalEngine } from "../signal-engine.js";
import { FeatureEngine } from "../feature-engine.js";
import { CandleStore } from "./candle-store.js";
import { DataQualityEngine } from "./data-quality.js";
import { InstrumentRegistry } from "./instrument-registry.js";
import { MarketBehaviorEngine } from "./behavior-engine.js";
import { createTick, RollingTickBuffer } from "./tick-buffer.js";
export class BrowserObservationManager {
    orchestrator;
    provider;
    state = {
        observationSessionId: null, provider: null, providerUrl: null, browser: "CLOSED", login: "USER_ACTION_REQUIRED",
        observation: "STOPPED", marketData: "NOT_AVAILABLE", selectedPair: null, timeframe: null, lastUpdate: null,
        dataQuality: "WAITING", instruments: [], candles: {}, agents: {}, lastDecision: null, lastCycleId: null, reason: null, behavior: null,
        tick: { sampleSize: 0, price: null, delta: null, signal: null },
    };
    registry = new InstrumentRegistry();
    candleStore = new CandleStore();
    quality = new DataQualityEngine();
    features = new FeatureEngine();
    signalEngine = new BinarySignalEngine();
    behaviorEngine = new MarketBehaviorEngine();
    tickBuffers = new Map();
    lastTickSignals = new Map();
    constructor(orchestrator, provider) {
        this.orchestrator = orchestrator;
        this.provider = provider;
    }
    openWorkspace(provider, providerUrl) {
        this.state.provider = provider;
        this.state.providerUrl = providerUrl;
        this.state.browser = "OPEN";
        this.state.login = "USER_ACTION_REQUIRED";
        this.state.observation = "STOPPED";
        this.state.marketData = "NOT_AVAILABLE";
        this.state.reason = "USER_MUST_LOGIN_ON_PROVIDER_WEBSITE";
        return this.snapshot();
    }
    start(provider, providerUrl, userConfirmedLogin) {
        if (!userConfirmedLogin)
            return this.block("USER_LOGIN_REQUIRED");
        if (this.state.observation === "OBSERVING" && this.state.observationSessionId) {
            this.state.provider = provider;
            this.state.providerUrl = providerUrl;
            this.state.browser = "OPEN";
            this.state.login = "USER_CONFIRMED";
            this.state.reason = null;
            console.info(`[OBSERVATION] session_reused observation_session_id=${this.state.observationSessionId}`);
            return this.snapshot();
        }
        this.state.provider = provider;
        this.state.providerUrl = providerUrl;
        this.state.browser = "OPEN";
        this.state.login = "USER_CONFIRMED";
        this.state.observation = "OBSERVING";
        this.state.marketData = "NOT_AVAILABLE";
        this.state.dataQuality = "WAITING";
        this.state.observationSessionId = `OBS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
        this.state.reason = null;
        console.info(`[BROWSER] workspace_opened provider=${provider}`);
        console.info(`[USER] manual_login_confirmed observation_session_id=${this.state.observationSessionId}`);
        console.info(`[OBSERVATION] session_started observation_session_id=${this.state.observationSessionId}`);
        return this.snapshot();
    }
    stop(reason = "USER_STOPPED") {
        this.state.observation = "STOPPED";
        this.state.marketData = "NOT_AVAILABLE";
        this.state.reason = reason;
        return this.snapshot();
    }
    closeBrowser() {
        this.state.browser = "CLOSED";
        if (this.state.observation === "OBSERVING")
            this.stop("BROWSER_CLOSED");
        return this.snapshot();
    }
    async discover(pairs) {
        if (!this.state.observationSessionId || this.state.observation !== "OBSERVING")
            return this.block("OBSERVATION_NOT_ACTIVE");
        const provider = this.state.provider ?? "CONFIGURED_PROVIDER";
        const items = pairs.filter((item) => item.symbol.trim()).map((item) => {
            const [baseAsset = item.symbol, quoteAsset = ""] = item.symbol.split("/");
            return { symbol: item.symbol, baseAsset, quoteAsset, provider, providerId: provider, providerSymbol: item.providerSymbol ?? item.symbol, supportedTimeframes: [item.timeframe ?? "1m"], dataSource: "browser-observation", timezone: "UTC", metadata: { observationMethod: "user-visible-provider-interface" } };
        });
        this.state.instruments = this.registry.discover(items);
        console.info(`[PAIR-DISCOVERY] observation_session_id=${this.state.observationSessionId} count=${this.state.instruments.length}`);
        return this.snapshot();
    }
    async observe(event) {
        if (!this.state.observationSessionId || this.state.observation !== "OBSERVING")
            return this.block("OBSERVATION_NOT_ACTIVE");
        const instrument = this.state.instruments.find((item) => item.symbol === event.symbol && item.provider === this.state.provider);
        if (!instrument)
            return this.block("PAIR_NOT_DISCOVERED");
        const timestamp = Date.parse(event.timestamp);
        const closeTimestamp = Date.parse(event.closeTimestamp);
        const now = Date.now();
        const valid = Number.isFinite(timestamp) && Number.isFinite(closeTimestamp) && timestamp < closeTimestamp && closeTimestamp <= now && [event.open, event.high, event.low, event.close].every(Number.isFinite)
            && event.high >= Math.max(event.open, event.close) && event.low <= Math.min(event.open, event.close);
        if (!valid) {
            this.state.dataQuality = "INVALID";
            this.state.reason = "INVALID_OBSERVED_EVENT";
            console.warn(`[DATA-QUALITY] status=INVALID observation_session_id=${this.state.observationSessionId} reason=INVALID_OBSERVED_EVENT`);
            return this.snapshot();
        }
        const input = {
            instrumentId: instrument.instrumentId, timeframe: event.timeframe, openTimestamp: event.timestamp, closeTimestamp: event.closeTimestamp,
            open: event.open, high: event.high, low: event.low, close: event.close, volume: event.volume ?? null, sourceTimestamp: event.timestamp,
            ingestionTimestamp: new Date(now).toISOString(), provider: instrument.provider, ...(instrument.providerId ? { providerId: instrument.providerId } : {}), providerSymbol: instrument.providerSymbol,
            ...(instrument.sourceType ? { sourceType: instrument.sourceType } : {}), dataQuality: "VALID", qualityStatus: "VALID", completenessStatus: "PARTIAL", sequenceNumber: null,
        };
        const candle = this.candleStore.upsert(input);
        const history = this.candleStore.list(instrument.instrumentId, event.timeframe);
        const report = this.quality.evaluate(history, new Date(now));
        this.state.selectedPair = instrument.symbol;
        this.state.timeframe = event.timeframe;
        this.state.lastUpdate = new Date(now).toISOString();
        this.state.marketData = report.status === "VALID" ? "RECEIVING" : "STALE";
        this.state.dataQuality = report.status === "VALID" ? "VALID" : "INVALID";
        this.state.candles[instrument.symbol] = history.length;
        this.state.behavior = this.behaviorEngine.analyze(history, { pair: instrument.symbol, timeframe: event.timeframe, provider: instrument.provider, regime: "UNKNOWN", asOfTimestamp: event.closeTimestamp }).ledger;
        console.info(`[MARKET] real_market_event_received observation_session_id=${this.state.observationSessionId} provider=${instrument.provider} symbol=${instrument.symbol}`);
        console.info(`[CANDLE] ${instrument.symbol} ${event.timeframe} validated=${report.status === "VALID"}`);
        if (report.status !== "VALID")
            return this.snapshot();
        await this.runAnalysis(instrument, event.timeframe, candle, report.score, history);
        return this.snapshot();
    }
    async observeTick(event) {
        if (!this.state.observationSessionId || this.state.observation !== "OBSERVING")
            return this.block("OBSERVATION_NOT_ACTIVE");
        const instrument = this.state.instruments.find((item) => item.symbol === event.symbol && item.provider === this.state.provider);
        const timestamp = Date.parse(event.timestamp);
        if (!instrument)
            return this.block("PAIR_NOT_DISCOVERED");
        if (!Number.isFinite(timestamp) || timestamp > Date.now() || !Number.isFinite(event.price) || event.price <= 0) {
            this.state.dataQuality = "INVALID";
            this.state.reason = "INVALID_OBSERVED_TICK";
            return this.snapshot();
        }
        const buffer = this.tickBuffers.get(instrument.instrumentId) ?? new RollingTickBuffer(200);
        buffer.push(createTick(instrument.providerId ?? this.state.provider ?? "BROWSER", instrument.providerSymbol, instrument, event.price, event.timestamp));
        this.tickBuffers.set(instrument.instrumentId, buffer);
        const ticks = buffer.latest();
        const features = this.features.computeTicks(ticks);
        const signal = this.signalEngine.evaluateTicks(features, Date.now(), this.lastTickSignals.get(instrument.instrumentId) ?? null);
        if (signal.status === "QUALIFIED")
            this.lastTickSignals.set(instrument.instrumentId, Date.now());
        this.state.selectedPair = instrument.symbol;
        this.state.timeframe = event.timeframe ?? this.state.timeframe ?? "tick";
        this.state.lastUpdate = new Date(timestamp).toISOString();
        this.state.marketData = "RECEIVING";
        this.state.dataQuality = "VALID";
        this.state.tick = { sampleSize: features.sampleSize, price: features.lastPrice, delta: features.tickDelta, signal };
        console.info(`[TICK] browser_tick_received symbol=${instrument.symbol} samples=${features.sampleSize} signal=${signal.status}`);
        return this.snapshot();
    }
    async runAnalysis(instrument, timeframe, candle, dataQualityScore, history) {
        const cycleId = randomUUID();
        const vector = this.features.compute(history, candle.closeTimestamp);
        const featureValues = { returns: vector.returns, rollingReturn: vector.rollingReturn, range: vector.range, body: vector.body, bodyRatio: vector.bodyRatio, upperWick: vector.upperWick, lowerWick: vector.lowerWick, volatility: vector.volatility, momentum: vector.momentum };
        const request = { asset: instrument.symbol, ...(instrument.providerId ? { providerId: instrument.providerId } : {}), providerSymbol: instrument.providerSymbol, ...(instrument.sourceType ? { sourceType: instrument.sourceType } : {}), candleIds: [candle.candleId], timeframe, expirySeconds: 60, datasetVersion: `observation:${this.state.observationSessionId}:${cycleId}`, featureVersion: vector.featureVersion, dataQualityScore, regime: "UNKNOWN", featureValues };
        console.info(`[FEATURE] features_generated cycle_id=${cycleId} observation_session_id=${this.state.observationSessionId}`);
        const result = await this.orchestrator.analyze(request);
        this.state.lastCycleId = cycleId;
        this.state.lastDecision = result.direction;
        this.state.agents[instrument.symbol] = result.evidence.length;
        console.info(`[AGENTS] cycle_id=${cycleId} agents_executed=${result.evidence.length}`);
        console.info(`[MASTER] cycle_id=${cycleId} decision=${result.direction}`);
        const signal = this.signalEngine.evaluate(request, result, { status: "BLOCKED", simulatedExposure: 0, capitalAtRisk: 0, maximumDrawdown: null });
        this.state.lastDecision = signal.direction;
    }
    block(reason) {
        this.state.observation = "BLOCKED";
        this.state.marketData = "NOT_AVAILABLE";
        this.state.reason = reason;
        return this.snapshot();
    }
    snapshot() { return { ...this.state, instruments: [...this.state.instruments], candles: { ...this.state.candles }, agents: { ...this.state.agents } }; }
}
export function observationProviderState(manager) {
    const state = manager.state.observation === "BLOCKED" ? "BLOCKED" : manager.state.marketData === "RECEIVING" ? "DATA_RECEIVING" : manager.state.observation === "OBSERVING" ? "CONNECTING" : "DISCONNECTED";
    return { provider: manager.state.provider, state };
}
