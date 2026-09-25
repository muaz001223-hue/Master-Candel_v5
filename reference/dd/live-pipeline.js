import { FeatureEngine } from "../feature-engine.js";
import { LiveSignalStateMachine } from "../live-state.js";
import { DataQualityEngine } from "./data-quality.js";
import { CandleStore } from "./candle-store.js";
import { MarketEventStream } from "./event-stream.js";
import { InstrumentRegistry } from "./instrument-registry.js";
import { ContinuousMarketObserver } from "./observer.js";
export class LiveObservationPipeline {
    provider;
    state = new LiveSignalStateMachine();
    registry = new InstrumentRegistry();
    candles = new CandleStore();
    events = new MarketEventStream();
    quality = new DataQualityEngine();
    features = new FeatureEngine();
    observer;
    constructor(provider) {
        this.provider = provider;
        this.observer = new ContinuousMarketObserver(provider, this.registry, this.candles, this.events, { onValidatedCandle: async () => { this.state.setAnalyzing(); } });
    }
    async poll(timeframe) {
        this.state.setWaiting();
        const instruments = await this.observer.discover();
        if (instruments.length === 0) {
            this.state.setDegraded();
            return [];
        }
        const results = [];
        for (const instrument of instruments) {
            if (!instrument.supportedTimeframes.includes(timeframe))
                continue;
            const closedCandles = await this.observer.poll(instrument, timeframe);
            const history = this.candles.list(instrument.instrumentId, timeframe);
            const quality = this.quality.evaluate(history);
            if (quality.status !== "VALID") {
                this.state.setDegraded();
                results.push({ instrument, timeframe, closedCandles, quality, features: null, state: this.state.current });
                continue;
            }
            const latest = closedCandles.at(-1);
            const features = latest ? this.features.compute(history, latest.closeTimestamp) : null;
            results.push({ instrument, timeframe, closedCandles, quality, features, state: features ? "ANALYZING" : "WAITING_FOR_DATA" });
        }
        return results;
    }
    get eventHistory() { return this.events.list(); }
}
