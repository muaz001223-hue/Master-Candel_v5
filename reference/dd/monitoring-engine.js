export class MonitoringEngine {
    detectDrift(baseline, current, warningThreshold = 0.1, severeThreshold = 0.25) {
        if (baseline.length === 0 || current.length === 0)
            return { status: "UNKNOWN", populationDifference: null, predictionDifference: null, reasons: ["INSUFFICIENT_SAMPLE"] };
        const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
        const difference = Math.abs(mean(baseline) - mean(current));
        const status = difference >= severeThreshold ? "SEVERE" : difference >= warningThreshold ? "WARNING" : "CLEAR";
        return { status, populationDifference: difference, predictionDifference: difference, reasons: status === "CLEAR" ? [] : ["DISTRIBUTION_SHIFT"] };
    }
    stressTest(input) {
        return [
            { scenario: "VOLATILITY_INCREASE", status: input.volatilityMultiplier > 2 ? "FAIL" : input.volatilityMultiplier > 1.25 ? "WARNING" : "PASS", reason: input.volatilityMultiplier > 1.25 ? "Volatility exceeds baseline tolerance" : "Within configured tolerance" },
            { scenario: "MISSING_DATA", status: input.missingDataRatio > 0.2 ? "FAIL" : input.missingDataRatio > 0.05 ? "WARNING" : "PASS", reason: input.missingDataRatio > 0.05 ? "Missing-data ratio requires investigation" : "Data completeness is within tolerance" },
            { scenario: "PROVIDER_FAILURE", status: input.providerAvailable ? "PASS" : "FAIL", reason: input.providerAvailable ? "Provider available" : "Provider unavailable; signal generation must fail closed" },
            { scenario: "DRAWDOWN", status: input.baselineDrawdown > 0.25 ? "FAIL" : input.baselineDrawdown > 0.1 ? "WARNING" : "PASS", reason: input.baselineDrawdown > 0.1 ? "Drawdown exceeds normal operating tolerance" : "Drawdown is within tolerance" },
        ];
    }
}
