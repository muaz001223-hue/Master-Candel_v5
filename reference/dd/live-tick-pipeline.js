import { randomUUID } from "node:crypto";
import { DataQualityEngine } from "./data-quality.js";
import { CandleStore } from "./candle-store.js";
import { FeatureEngine } from "../feature-engine.js";
import { LiveSignalStateMachine } from "../live-state.js";
import { RiskEngine } from "../risk-engine.js";
import { createTick, RollingTickBuffer, SecondCandleBuilder } from "./tick-buffer.js";
import { MarketBehaviorEngine } from "./behavior-engine.js";
export class LiveTickPipeline {
    provider;
    instrument;
    orchestrator;
    ticks;
    candleStore = new CandleStore();
    state = new LiveSignalStateMachine();
    builder;
    quality = new DataQualityEngine();
    features = new FeatureEngine();
    risk = new RiskEngine();
    behavior = new MarketBehaviorEngine();
    options;
    processing = Promise.resolve();
    stopSubscription = null;
    timer = null;
    latest = null;
    constructor(provider, instrument, orchestrator, options = {}) {
        this.provider = provider;
        this.instrument = instrument;
        this.orchestrator = orchestrator;
        this.options = { modelReady: options.modelReady ?? false, timeframeSeconds: options.timeframeSeconds ?? 1, startingCapital: options.startingCapital ?? 1000, maxQueuedCandles: options.maxQueuedCandles ?? 100, now: options.now ?? Date.now };
        this.ticks = new RollingTickBuffer(10_000);
        this.builder = new SecondCandleBuilder(instrument, provider.name, { timeframeSeconds: this.options.timeframeSeconds, now: this.options.now });
    }
    async start() {
        if (!this.provider.subscribeTicks)
            throw new Error(`Tick stream not supported by provider: ${this.provider.name}`);
        this.state.setWaiting();
        this.stopSubscription = await this.provider.subscribeTicks(this.instrument, async (tick) => this.receiveTick(createTick(this.instrument.providerId ?? this.provider.providerId ?? this.provider.name, this.instrument.providerSymbol, this.instrument, tick.price, tick.sourceTimestamp, tick.volume, new Date(this.options.now()).toISOString())));
        this.timer = setInterval(() => this.flush(), Math.max(100, this.options.timeframeSeconds * 1000));
        return () => this.stop();
    }
    stop() {
        this.stopSubscription?.();
        this.stopSubscription = null;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    get latestSignal() { return this.latest; }
    async receiveTick(tick) {
        this.ticks.push(tick);
        this.builder.add(tick);
        await Promise.resolve();
    }
    async flush(now = this.options.now()) {
        const candles = this.builder.close(now);
        for (const candle of candles.slice(0, this.options.maxQueuedCandles))
            this.processing = this.processing.then(() => this.processCandle(candle));
        await this.processing;
    }
    async processCandle(input) {
        this.state.setAnalyzing();
        const started = this.options.now();
        const candle = this.candleStore.upsert(input);
        const quality = this.quality.evaluate(this.candleStore.list(this.instrument.instrumentId, input.timeframe), new Date(this.options.now()));
        const base = this.resultBase(candle, started);
        const history = this.candleStore.list(this.instrument.instrumentId, input.timeframe);
        const behavior = this.behavior.analyze(history, { pair: this.instrument.symbol, timeframe: input.timeframe, provider: this.instrument.provider, regime: "UNKNOWN", asOfTimestamp: candle.closeTimestamp }).ledger;
        base.behavior = behavior;
        if (quality.status !== "VALID") {
            this.state.setDegraded();
            this.latest = { ...base, finalDecision: "NO_SIGNAL", state: "DATA_DEGRADED", riskStatus: "BLOCKED", probability: null, reason: "DATA_QUALITY_WARNING", latencyMs: this.options.now() - started };
            return;
        }
        if (!this.options.modelReady) {
            this.state.setInsufficientEvidence();
            this.latest = { ...base, finalDecision: "NO_SIGNAL", state: "INSUFFICIENT_EVIDENCE", riskStatus: "BLOCKED", probability: null, reason: "MODEL_NOT_READY", latencyMs: this.options.now() - started };
            return;
        }
        const features = this.features.compute(history, candle.closeTimestamp);
        const featureValues = { returns: features.returns, rollingReturn: features.rollingReturn, range: features.range, body: features.body, bodyRatio: features.bodyRatio, upperWick: features.upperWick, lowerWick: features.lowerWick, volatility: features.volatility, momentum: features.momentum };
        const request = { asset: this.instrument.symbol, providerId: this.instrument.providerId ?? this.provider.providerId ?? this.provider.name, providerSymbol: this.instrument.providerSymbol, ...(this.instrument.sourceType ? { sourceType: this.instrument.sourceType } : {}), candleIds: [candle.candleId], timeframe: input.timeframe, expirySeconds: this.options.timeframeSeconds, datasetVersion: `live:${this.instrument.providerId ?? this.provider.providerId ?? this.provider.name}`, featureVersion: features.featureVersion, dataQualityScore: quality.score, regime: "UNKNOWN", featureValues };
        const orchestration = await this.orchestrator.analyze(request);
        this.latest = this.buildSignal(base, candle, orchestration, started);
    }
    resultBase(candle, started) {
        return { signalId: randomUUID(), asset: this.instrument.symbol, timeframe: candle.timeframe, currentLivePrice: candle.close, ohlc: { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }, consensus: { callRatio: 0, putRatio: 0, eligibleAgents: 0, failedAgents: 0 }, riskStatus: "BLOCKED", finalDecision: "NO_SIGNAL", state: "ANALYZING", probability: null, providerId: this.instrument.providerId ?? this.provider.providerId ?? this.provider.name, providerStatus: "CONNECTED", timestamp: new Date(this.options.now()).toISOString(), latencyMs: this.options.now() - started, reason: null, behavior: null };
    }
    buildSignal(base, candle, orchestration, started) {
        const eligible = orchestration.evidence.length + orchestration.failedAgentIds.length;
        const calls = orchestration.evidence.filter((item) => item.output === "CALL").length;
        const puts = orchestration.evidence.filter((item) => item.output === "PUT").length;
        const riskReport = this.risk.evaluate({ startingCapital: this.options.startingCapital, stakes: [], outcomes: [] });
        const blocked = orchestration.direction === "NO_SIGNAL" || orchestration.reason !== null || riskReport.status !== "ACCEPTABLE";
        const decision = blocked ? "NO_SIGNAL" : orchestration.direction;
        const state = decision === "CALL" ? "CALL" : decision === "PUT" ? "PUT" : "NO_SIGNAL";
        this.state.apply({ signalId: base.signalId, asset: base.asset, timestamp: base.timestamp, timeframe: base.timeframe, expiryTimestamp: null, signal: decision, calibratedProbability: orchestration.weightedProbability, breakEvenProbability: null, probabilityEdge: null, modelAgreement: orchestration.agreement, regime: "UNKNOWN", dataQuality: null, uncertainty: "HIGH", modelVersions: [], featureVersion: null, validationSampleSize: 0, riskStatus: riskReport.status, provider: base.providerId, generatedAt: base.timestamp, expiresAt: null });
        return { ...base, consensus: { callRatio: eligible ? calls / eligible : 0, putRatio: eligible ? puts / eligible : 0, eligibleAgents: eligible, failedAgents: orchestration.failedAgentIds.length }, riskStatus: blocked ? "BLOCKED" : "PASSED", finalDecision: decision, state, probability: orchestration.weightedProbability, reason: orchestration.reason, latencyMs: this.options.now() - started };
    }
}
