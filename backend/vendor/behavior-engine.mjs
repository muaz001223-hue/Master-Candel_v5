import { randomUUID } from "node:crypto";
import { AdaptiveHorizonSelector } from "./adaptive-horizon.mjs";
export class PatternMemory {
    versions = [];
    record(items) {
        for (const item of items)
            this.versions.push({ ...item, features: { ...item.features } });
    }
    list(context) {
        return this.versions.filter((item) => !context || (item.pair === context.pair && item.timeframe === context.timeframe)).map((item) => ({ ...item, features: { ...item.features } }));
    }
}
export class BehaviorContextMatcher {
    match(memory, context) {
        const evidence = memory.list(context).filter((item) => item.provider === context.provider && item.timestamp <= context.asOfTimestamp && item.validationStatus === "VALIDATED");
        if (evidence.length === 0)
            return { status: "INSUFFICIENT_DATA", evidence: [] };
        const sameRegime = evidence.filter((item) => item.features.regime === context.regime || item.features.regime === null || item.features.regime === undefined);
        return { status: sameRegime.length === evidence.length ? "MATCH" : sameRegime.length ? "PARTIAL_MATCH" : "NO_MATCH", evidence: sameRegime };
    }
}
function usable(candle, asOf) {
    const close = Date.parse(candle.closeTimestamp);
    return Number.isFinite(close) && close <= asOf && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite);
}
function boundedCandles(candles, context) {
    const asOf = Date.parse(context.asOfTimestamp);
    return candles.filter((candle) => usable(candle, asOf)).sort((a, b) => a.closeTimestamp.localeCompare(b.closeTimestamp));
}
function evidence(module, version, context, direction, label, features, sampleSize, status = "CANDIDATE") {
    return {
        evidenceId: randomUUID(), module, version, pair: context.pair, timeframe: context.timeframe, provider: context.provider,
        timestamp: context.asOfTimestamp, direction, label, features, status,
        validationStatus: sampleSize > 0 ? "UNVERIFIED" : "INSUFFICIENT_DATA", sampleSize,
        stabilityScore: null, uncertainty: sampleSize >= 30 ? "MODERATE" : "HIGH", source: "CANDLE",
    };
}
export class PatternDiscoveryDetector {
    name = "PATTERN-DETECTOR";
    version = "pattern-1.0.0";
    detect(candles, context) {
        const current = boundedCandles(candles, context).at(-1);
        if (!current)
            return [];
        const range = current.high - current.low;
        if (range <= 0)
            return [];
        const body = Math.abs(current.close - current.open) / range;
        const upper = current.high - Math.max(current.open, current.close);
        const lower = Math.min(current.open, current.close) - current.low;
        const results = [];
        if (body < 0.2)
            results.push(evidence(this.name, this.version, context, "NO_SIGNAL", "DOJI_CANDIDATE", { bodyRatio: body }, 1));
        if (lower / range > 0.6 && current.close > current.open)
            results.push(evidence(this.name, this.version, context, "CALL", "HAMMER_CANDIDATE", { lowerWickRatio: lower / range }, 1));
        if (upper / range > 0.6 && current.close < current.open)
            results.push(evidence(this.name, this.version, context, "PUT", "SHOOTING_STAR_CANDIDATE", { upperWickRatio: upper / range }, 1));
        return results;
    }
}
export class SequenceStateTransitionDetector {
    sequenceLength;
    name = "SEQUENCE-DETECTOR";
    version = "sequence-1.0.0";
    constructor(sequenceLength = 3) {
        this.sequenceLength = sequenceLength;
    }
    detect(candles, context) {
        const recent = boundedCandles(candles, context).slice(-this.sequenceLength);
        if (recent.length < this.sequenceLength)
            return [];
        const signs = recent.map((candle) => Math.sign(candle.close - candle.open));
        const sameDirection = signs.every((sign) => sign === 1) || signs.every((sign) => sign === -1);
        const last = signs.at(-1) ?? 0;
        if (!sameDirection || last === 0)
            return [];
        const direction = last > 0 ? "CALL" : "PUT";
        return [evidence(this.name, this.version, context, direction, "MOMENTUM_CONTINUATION_CANDIDATE", { sequenceLength: recent.length, directionChanges: signs.slice(1).filter((sign, index) => sign !== signs[index]).length }, recent.length)];
    }
}
export class PriceLevelReactionDetector {
    name = "PRICE-LEVEL-DETECTOR";
    version = "price-level-1.0.0";
    detect(candles, context) {
        const recent = boundedCandles(candles, context);
        if (recent.length < 3)
            return [];
        const current = recent.at(-1);
        const prior = recent.slice(0, -1);
        const previousHigh = Math.max(...prior.map((candle) => candle.high));
        const previousLow = Math.min(...prior.map((candle) => candle.low));
        if (current.high > previousHigh && current.close < previousHigh)
            return [evidence(this.name, this.version, context, "PUT", "LEVEL_FALSE_BREAK", { level: previousHigh, touchCount: prior.filter((candle) => candle.high >= previousHigh).length }, prior.length)];
        if (current.low < previousLow && current.close > previousLow)
            return [evidence(this.name, this.version, context, "CALL", "LEVEL_FALSE_BREAK", { level: previousLow, touchCount: prior.filter((candle) => candle.low <= previousLow).length }, prior.length)];
        return [];
    }
}
export class TemporalBehaviorDetector {
    name = "TEMPORAL-DETECTOR";
    version = "temporal-1.0.0";
    detect(candles, context) {
        const recent = boundedCandles(candles, context);
        if (recent.length < 20)
            return [];
        const hour = new Date(context.asOfTimestamp).getUTCHours();
        const window = recent.filter((candle) => new Date(candle.closeTimestamp).getUTCHours() === hour);
        if (window.length < 5)
            return [];
        const positive = window.filter((candle) => candle.close > candle.open).length / window.length;
        const direction = positive > 0.6 ? "CALL" : positive < 0.4 ? "PUT" : "NO_SIGNAL";
        return [evidence(this.name, this.version, context, direction, "TIME_WINDOW_BIAS_CANDIDATE", { utcHour: hour, positiveRate: positive }, window.length)];
    }
}
export class VolatilityRegimeTransitionDetector {
    name = "REGIME-DETECTOR";
    version = "regime-transition-1.0.0";
    detect(candles, context) {
        const recent = boundedCandles(candles, context);
        if (recent.length < 10)
            return [];
        const ranges = recent.map((candle) => candle.high - candle.low);
        const baseline = ranges.slice(0, -3).reduce((sum, value) => sum + value, 0) / Math.max(1, ranges.length - 3);
        const current = ranges.slice(-3).reduce((sum, value) => sum + value, 0) / 3;
        if (baseline <= 0)
            return [];
        const expansion = current / baseline;
        const label = expansion > 1.5 ? "VOLATILITY_EXPANSION" : expansion < 0.65 ? "VOLATILITY_CONTRACTION" : "NORMALIZATION";
        return [evidence(this.name, this.version, context, "NO_SIGNAL", label, { expansionRatio: expansion, previousRegime: context.regime }, recent.length)];
    }
}
export class MovementBehaviorDetector {
    name = "MOVEMENT-DETECTOR";
    version = "movement-1.0.0";
    detect(candles, context) {
        const recent = boundedCandles(candles, context);
        if (recent.length < 4)
            return [];
        const signs = recent.slice(-4).map((candle) => Math.sign(candle.close - candle.open));
        const up = signs.filter((sign) => sign > 0).length;
        const down = signs.filter((sign) => sign < 0).length;
        const direction = up === 4 ? "CALL" : down === 4 ? "PUT" : "NO_SIGNAL";
        return [evidence(this.name, this.version, context, direction, direction === "NO_SIGNAL" ? "MIXED_MOVEMENT" : "DIRECTIONAL_PERSISTENCE", { consecutiveUp: up, consecutiveDown: down }, recent.length)];
    }
}
export class PatternEvolutionEngine {
    name = "PATTERN-EVOLUTION";
    version = "pattern-evolution-1.0.0";
    detect(candles, context) {
        const recent = boundedCandles(candles, context);
        if (recent.length < 30)
            return [];
        return [evidence(this.name, this.version, context, "NO_SIGNAL", "CANDIDATE_STRUCTURE_DISCOVERED", { observations: recent.length, validation: "REQUIRED" }, recent.length, "DISCOVERED")];
    }
}
export class BehaviorAgreementEngine {
    evaluate(evidence) {
        const directional = evidence.filter((item) => item.direction !== "NO_SIGNAL");
        const groups = new Map();
        for (const item of directional)
            groups.set(item.direction, [...(groups.get(item.direction) ?? []), item]);
        const weighted = (items) => items.reduce((sum, item) => sum + (item.validationStatus === "VALIDATED" ? 1 : 0.25) * (item.sampleSize > 0 ? Math.min(1, item.sampleSize / 30) : 0.25), 0);
        const callWeight = weighted(groups.get("CALL") ?? []);
        const putWeight = weighted(groups.get("PUT") ?? []);
        const total = callWeight + putWeight;
        const agreement = total === 0 ? 0 : Math.max(callWeight, putWeight) / total;
        const contradictionCount = groups.has("CALL") && groups.has("PUT") ? 1 : 0;
        const independentEvidenceCount = new Set(evidence.map((item) => item.module)).size;
        return { agreement, disagreement: total === 0 ? 0 : 1 - agreement, independentEvidenceCount, contradictionCount, evidenceStrength: total === 0 ? 0 : Math.min(1, total / 3), uncertainty: agreement >= 0.8 && contradictionCount === 0 ? "MODERATE" : "HIGH", validationQuality: evidence.some((item) => item.validationStatus === "VALIDATED") ? "VALIDATED" : evidence.length ? "UNVERIFIED" : "INSUFFICIENT_DATA" };
    }
}
export class MarketBehaviorEngine {
    version = "market-behavior-1.0.0";
    detectors = [new PatternDiscoveryDetector(), new SequenceStateTransitionDetector(), new PriceLevelReactionDetector(), new TemporalBehaviorDetector(), new VolatilityRegimeTransitionDetector(), new MovementBehaviorDetector(), new PatternEvolutionEngine()];
    agreement = new BehaviorAgreementEngine();
    horizons = new AdaptiveHorizonSelector();
    memory = new PatternMemory();
    matcher = new BehaviorContextMatcher();
    analyze(candles, context) {
        const all = [];
        const events = [];
        for (const detector of this.detectors) {
            const found = detector.detect(candles, context);
            all.push(...found);
            for (const item of found)
                events.push({ module: detector.name, status: item.status, evidenceId: item.evidenceId, timestamp: context.asOfTimestamp });
        }
        const agreement = this.agreement.evaluate(all);
        this.memory.record(all);
        const bucket = (name) => all.filter((item) => item.module === name);
        const horizon = this.horizons.select([]);
        const ledger = { pair: context.pair, timeframe: context.timeframe, provider: context.provider, timestamp: context.asOfTimestamp, regime: context.regime, patternMatches: bucket("PATTERN-DETECTOR"), sequenceMatches: bucket("SEQUENCE-DETECTOR"), priceLevelEvidence: bucket("PRICE-LEVEL-DETECTOR"), temporalEvidence: bucket("TEMPORAL-DETECTOR"), regimeEvidence: bucket("REGIME-DETECTOR"), movementEvidence: bucket("MOVEMENT-DETECTOR"), discoveredPatternEvidence: bucket("PATTERN-EVOLUTION"), ...agreement, selectedHorizonMinutes: horizon.selectedHorizonMinutes, horizonStatus: horizon.status, finalGateStatus: agreement.validationQuality === "VALIDATED" && agreement.contradictionCount === 0 && agreement.evidenceStrength >= 0.7 && horizon.status === "SELECTED" ? "UNDER_REVIEW" : "NO_SIGNAL" };
        for (const event of events)
            console.info(`[BEHAVIOR-ENGINE] module=${event.module} pair=${context.pair} timeframe=${context.timeframe} provider=${context.provider} status=${event.status} evidence_id=${event.evidenceId}`);
        console.info(`[BEHAVIOR-AGREEMENT] pair=${context.pair} agreement=${ledger.agreement.toFixed(3)} contradiction=${ledger.contradictionCount} validation=${ledger.validationQuality}`);
        return { ledger, events };
    }
}
