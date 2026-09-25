import { randomUUID } from "node:crypto";
export class CandleStore {
    current = new Map();
    history = new Map();
    upsert(input) {
        const key = this.key(input.instrumentId, input.timeframe, input.openTimestamp);
        const previous = this.current.get(key);
        if (previous && !this.isCorrection(previous, input))
            return previous;
        const next = {
            ...input,
            candleId: previous?.candleId ?? randomUUID(),
            state: input.state ?? (previous ? "UPDATED" : "OPEN"),
            version: (previous?.version ?? 0) + 1,
        };
        if (previous && this.isCorrection(previous, next)) {
            next.state = "CORRECTED";
            this.history.set(key, [...(this.history.get(key) ?? []), previous]);
        }
        this.current.set(key, next);
        return next;
    }
    close(instrumentId, timeframe, openTimestamp) {
        const key = this.key(instrumentId, timeframe, openTimestamp);
        const candle = this.current.get(key);
        if (!candle)
            return undefined;
        const closed = { ...candle, state: "CLOSED", completenessStatus: "COMPLETE", version: candle.version + 1 };
        this.current.set(key, closed);
        return closed;
    }
    validate(instrumentId, timeframe, openTimestamp, valid) {
        const key = this.key(instrumentId, timeframe, openTimestamp);
        const candle = this.current.get(key);
        if (!candle)
            return undefined;
        const validated = { ...candle, state: valid ? "VALIDATED" : "INVALID", qualityStatus: valid ? "VALID" : "INVALID", version: candle.version + 1 };
        this.current.set(key, validated);
        return validated;
    }
    getHistory(instrumentId, timeframe, openTimestamp) {
        return [...(this.history.get(this.key(instrumentId, timeframe, openTimestamp)) ?? [])];
    }
    list(instrumentId, timeframe) {
        return [...this.current.values()].filter((candle) => candle.instrumentId === instrumentId && candle.timeframe === timeframe).sort((a, b) => a.openTimestamp.localeCompare(b.openTimestamp));
    }
    key(instrumentId, timeframe, openTimestamp) {
        return `${instrumentId}:${timeframe}:${openTimestamp}`;
    }
    isCorrection(previous, next) {
        return previous.open !== next.open || previous.high !== next.high || previous.low !== next.low || previous.close !== next.close || previous.volume !== next.volume;
    }
}
