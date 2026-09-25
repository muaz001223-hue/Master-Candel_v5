export class ContinuousMarketObserver {
    provider;
    registry;
    candles;
    events;
    downstream;
    constructor(provider, registry, candles, events, downstream) {
        this.provider = provider;
        this.registry = registry;
        this.candles = candles;
        this.events = events;
        this.downstream = downstream;
    }
    async discover() {
        try {
            const instruments = this.registry.discover(await this.provider.discoverInstruments());
            for (const instrument of instruments) {
                this.events.emit({ eventType: "INSTRUMENT_DISCOVERED", instrumentId: instrument.instrumentId, timeframe: "*", source: this.provider.name, payload: { symbol: instrument.symbol } });
            }
            return instruments;
        }
        catch (error) {
            this.registry.markUnavailable(this.provider.name);
            this.events.emit({ eventType: "PROVIDER_FAILURE", instrumentId: "*", timeframe: "*", source: this.provider.name, payload: { error: error instanceof Error ? error.message : "unknown" } });
            return [];
        }
    }
    async poll(instrument, timeframe) {
        try {
            const received = await this.provider.fetchCandles(instrument, timeframe);
            const closed = [];
            for (const input of received) {
                const stored = this.candles.upsert(input);
                const isClosed = stored.completenessStatus === "COMPLETE" || stored.state === "CLOSED";
                this.events.emit({ eventType: isClosed ? "CANDLE_CLOSED" : "CANDLE_UPDATED", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { candleId: stored.candleId, version: stored.version } });
                if (isClosed) {
                    const validated = this.candles.validate(instrument.instrumentId, timeframe, stored.openTimestamp, stored.qualityStatus !== "INVALID");
                    if (validated?.state === "VALIDATED") {
                        closed.push(validated);
                        await this.downstream.onValidatedCandle(validated);
                    }
                }
            }
            return closed;
        }
        catch (error) {
            this.events.emit({ eventType: "PROVIDER_FAILURE", instrumentId: instrument.instrumentId, timeframe, source: this.provider.name, payload: { error: error instanceof Error ? error.message : "unknown" } });
            return [];
        }
    }
}
