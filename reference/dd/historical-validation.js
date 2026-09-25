function ordered(items) {
    return [...items].sort((left, right) => left.observationTimestamp.localeCompare(right.observationTimestamp));
}
function futureCandle(candles, observationTimestamp, horizonMinutes) {
    const observation = Date.parse(observationTimestamp);
    const target = observation + horizonMinutes * 60_000;
    return candles.filter((candle) => {
        const close = Date.parse(candle.closeTimestamp);
        return Number.isFinite(close) && close >= target && close > observation;
    }).sort((left, right) => left.closeTimestamp.localeCompare(right.closeTimestamp))[0] ?? null;
}
export function labelOutcome(match, observationClose, candles, horizonMinutes) {
    const target = futureCandle(candles, match.observationTimestamp, horizonMinutes);
    if (!target)
        return { ...match, outcomeTimestamp: null, outcome: null, returnChange: null, status: "PENDING", horizonMinutes };
    const outcome = match.direction === "CALL" ? target.close > observationClose : target.close < observationClose;
    return { ...match, outcomeTimestamp: target.closeTimestamp, outcome, returnChange: observationClose === 0 ? null : (target.close - observationClose) / observationClose, status: "EVALUATED", horizonMinutes };
}
export function calculateMetrics(labels) {
    const evaluated = labels.filter((item) => item.status === "EVALUATED" && item.outcome !== null);
    const first = labels[0];
    const base = { regime: first?.regime ?? "UNKNOWN", symbol: first?.symbol ?? "UNKNOWN", timeframe: first?.timeframe ?? "UNKNOWN" };
    if (evaluated.length === 0)
        return { ...base, sampleSize: 0, wins: 0, losses: 0, hitRate: null, precision: null, recall: null, f1: null, brierScore: null, logLoss: null, calibration: null, maximumDrawdown: null, longestLosingStreak: 0 };
    const wins = evaluated.filter((item) => item.outcome).length;
    const losses = evaluated.length - wins;
    const probabilities = evaluated.map((item) => item.probability);
    const brierScore = evaluated.reduce((sum, item) => sum + (item.probability - (item.outcome ? 1 : 0)) ** 2, 0) / evaluated.length;
    const logLoss = evaluated.reduce((sum, item) => sum - Math.log(Math.max(1e-12, item.outcome ? item.probability : 1 - item.probability)), 0) / evaluated.length;
    let capital = 1;
    let peak = 1;
    let drawdown = 0;
    let losing = 0;
    let longest = 0;
    for (const item of evaluated) {
        if (item.outcome) {
            capital += 0.8;
            losing = 0;
        }
        else {
            capital -= 1;
            losing += 1;
            longest = Math.max(longest, losing);
        }
        peak = Math.max(peak, capital);
        drawdown = Math.max(drawdown, peak === 0 ? 1 : (peak - capital) / peak);
    }
    const predictedPositive = evaluated.filter((item) => item.direction === "CALL");
    const actualPositive = evaluated.filter((item) => item.outcome);
    const truePositive = predictedPositive.filter((item) => item.outcome).length;
    const precision = predictedPositive.length ? truePositive / predictedPositive.length : null;
    const recall = actualPositive.length ? truePositive / actualPositive.length : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
    const meanProbability = probabilities.reduce((sum, item) => sum + item, 0) / probabilities.length;
    const calibration = Math.abs(meanProbability - wins / evaluated.length);
    return { ...base, sampleSize: evaluated.length, wins, losses, hitRate: wins / evaluated.length, precision, recall, f1, brierScore, logLoss, calibration, maximumDrawdown: drawdown, longestLosingStreak: longest };
}
export function purgedEmbargoSplit(items, trainSize, validationSize, testSize, embargoMinutes) {
    const source = ordered(items);
    const splits = [];
    for (let start = 0; start + trainSize + validationSize + testSize <= source.length; start += testSize) {
        const trainEnd = Date.parse(source[start + trainSize - 1].observationTimestamp);
        const validationStart = Date.parse(source[start + trainSize].observationTimestamp);
        const validationEnd = Date.parse(source[start + trainSize + validationSize - 1].observationTimestamp);
        const testStart = Date.parse(source[start + trainSize + validationSize].observationTimestamp);
        const train = source.slice(start, start + trainSize).filter((item) => !item.outcomeTimestamp || Date.parse(item.outcomeTimestamp) < validationStart);
        const validate = source.slice(start + trainSize, start + trainSize + validationSize).filter((item) => Date.parse(item.observationTimestamp) >= trainEnd + embargoMinutes * 60_000);
        const test = source.slice(start + trainSize + validationSize, start + trainSize + validationSize + testSize).filter((item) => Date.parse(item.observationTimestamp) >= validationEnd + embargoMinutes * 60_000 && Date.parse(item.observationTimestamp) >= testStart);
        splits.push({ train, validate, test });
    }
    return splits;
}
export function walkForward(items, trainSize, validationSize, testSize, embargoMinutes) {
    return purgedEmbargoSplit(items, trainSize, validationSize, testSize, embargoMinutes);
}
export function validatePattern(matches, labels, minimumSampleSize = 100) {
    const first = matches[0] ?? labels[0];
    const metrics = calculateMetrics(labels);
    const base = { patternId: first?.patternId ?? "UNKNOWN", evidenceId: first?.evidenceId ?? "UNKNOWN", symbol: first?.symbol ?? "UNKNOWN", provider: first?.provider ?? "UNKNOWN", timeframe: first?.timeframe ?? "UNKNOWN", regime: first?.regime ?? "UNKNOWN", observationTimestamp: first?.observationTimestamp ?? "", outcomeTimestamp: labels.at(-1)?.outcomeTimestamp ?? null, validationVersion: first?.validationVersion ?? "validation-1.0.0", datasetVersion: first?.datasetVersion ?? "UNKNOWN", sampleSize: metrics.sampleSize, metrics };
    if (metrics.sampleSize < minimumSampleSize)
        return { ...base, status: "INSUFFICIENT_EVIDENCE", lifecycle: "CANDIDATE", reason: "HISTORICAL_OUTCOME_SAMPLE_TOO_SMALL" };
    if (metrics.brierScore === null || metrics.calibration === null || metrics.calibration > 0.1)
        return { ...base, status: "REJECTED", lifecycle: "UNDER_REVIEW", reason: "CALIBRATION_FAILED" };
    return { ...base, status: "VALIDATED", lifecycle: "VALIDATED", reason: "OUTCOME_AND_VALIDATION_GATES_PASSED" };
}
