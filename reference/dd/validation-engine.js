export class ValidationEngine {
    backtest(observations, threshold = 0.5) {
        const ordered = [...observations].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const leakageDetected = observations.some((item, index) => index > 0 && item.timestamp < observations[index - 1].timestamp);
        const accuracy = ordered.length === 0 ? null : ordered.filter((item) => (item.prediction >= threshold) === item.outcome).length / ordered.length;
        const brierScore = ordered.length === 0 ? null : ordered.reduce((sum, item) => sum + (item.prediction - (item.outcome ? 1 : 0)) ** 2, 0) / ordered.length;
        let capital = 1;
        let peak = 1;
        let maxDrawdown = 0;
        ordered.forEach((item) => { capital *= item.outcome ? 1.01 : 0.99; peak = Math.max(peak, capital); maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak); });
        return { historicalSimulation: true, observationCount: ordered.length, accuracy, brierScore, maxDrawdown, leakageDetected };
    }
    walkForward(observations, trainSize, validationSize, testSize, step = testSize) {
        const ordered = [...observations].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const windows = [];
        for (let start = 0; start + trainSize + validationSize + testSize <= ordered.length; start += step) {
            windows.push({ train: ordered.slice(start, start + trainSize), validate: ordered.slice(start + trainSize, start + trainSize + validationSize), test: ordered.slice(start + trainSize + validationSize, start + trainSize + validationSize + testSize) });
        }
        return windows;
    }
}
