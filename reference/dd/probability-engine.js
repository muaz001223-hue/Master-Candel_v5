export function breakEvenProbability(payout) {
    if (!Number.isFinite(payout) || payout <= 0)
        throw new Error("payout must be greater than zero");
    return 1 / (1 + payout);
}
export function probabilityMetrics(predictions, outcomes, acceptableCalibrationError = 0.05) {
    if (predictions.length !== outcomes.length)
        throw new Error("predictions and outcomes must have equal lengths");
    if (predictions.length === 0)
        return { sampleSize: 0, brierScore: null, logLoss: null, expectedCalibrationError: null, calibrationStatus: "UNKNOWN" };
    const clipped = predictions.map((prediction) => Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, prediction)));
    const brierScore = clipped.reduce((sum, prediction, index) => sum + (prediction - (outcomes[index] ? 1 : 0)) ** 2, 0) / clipped.length;
    const logLoss = -clipped.reduce((sum, prediction, index) => sum + (outcomes[index] ? Math.log(prediction) : Math.log(1 - prediction)), 0) / clipped.length;
    const bins = Array.from({ length: 10 }, (_, index) => ({ lower: index / 10, upper: (index + 1) / 10, values: [], results: [] }));
    clipped.forEach((prediction, index) => { const bin = bins[Math.min(9, Math.floor(prediction * 10))]; bin.values.push(prediction); bin.results.push(outcomes[index]); });
    const expectedCalibrationError = bins.reduce((sum, bin) => bin.values.length === 0 ? sum : sum + Math.abs(bin.values.reduce((a, b) => a + b, 0) / bin.values.length - bin.results.filter(Boolean).length / bin.results.length) * bin.values.length / clipped.length, 0);
    return { sampleSize: clipped.length, brierScore, logLoss, expectedCalibrationError, calibrationStatus: expectedCalibrationError <= acceptableCalibrationError ? "ACCEPTABLE" : "FAILED" };
}
export function calibrateProbability(rawProbability, historicalPredictions, historicalOutcomes, acceptableCalibrationError = 0.05) {
    if (historicalPredictions.length !== historicalOutcomes.length)
        throw new Error("calibration inputs must have equal lengths");
    if (historicalPredictions.length === 0)
        return { calibratedProbability: rawProbability, metrics: probabilityMetrics([], [], acceptableCalibrationError), bins: [] };
    const bins = Array.from({ length: 10 }, (_, index) => ({ lowerBound: index / 10, upperBound: (index + 1) / 10, count: 0, predicted: null, observed: null }));
    historicalPredictions.forEach((prediction, index) => { const bin = bins[Math.min(9, Math.floor(Math.min(0.999999, Math.max(0, prediction)) * 10))]; bin.count += 1; bin.predicted = (bin.predicted ?? 0) + prediction; bin.observed = (bin.observed ?? 0) + (historicalOutcomes[index] ? 1 : 0); });
    bins.forEach((bin) => { if (bin.count > 0) {
        bin.predicted = bin.predicted / bin.count;
        bin.observed = bin.observed / bin.count;
    } });
    const selected = bins[Math.min(9, Math.floor(Math.min(0.999999, Math.max(0, rawProbability)) * 10))];
    return { calibratedProbability: selected.observed ?? rawProbability, metrics: probabilityMetrics(historicalPredictions, historicalOutcomes, acceptableCalibrationError), bins };
}
