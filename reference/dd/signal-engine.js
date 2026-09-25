import { randomUUID } from "node:crypto";
const DEFAULT_POLICY = {
    minimumDataQuality: 85,
    minimumAgreement: 0.7,
    minimumValidationSample: 100,
    minimumProbabilityEdge: 0.02,
    minimumWinProbability: 0,
    maximumUncertainty: "MODERATE",
    payout: 0.8,
    validitySeconds: 60,
};
export class BinarySignalEngine {
    policy;
    constructor(policy = {}) {
        this.policy = { ...DEFAULT_POLICY, ...policy };
        if (this.policy.payout <= 0)
            throw new Error("payout must be greater than zero");
    }
    evaluate(request, orchestration, risk) {
        const createdAt = new Date();
        const calibratedProbability = orchestration.weightedProbability;
        const breakEvenProbability = 1 / (1 + this.policy.payout);
        const probabilityDifference = calibratedProbability === null ? null : calibratedProbability - breakEvenProbability;
        const representative = this.representativeEvidence(orchestration.evidence);
        const state = this.gateState(request, orchestration, risk, representative, breakEvenProbability);
        const direction = state === "VALID_SIGNAL" ? orchestration.direction : "NO_SIGNAL";
        return {
            signalId: randomUUID(),
            signalType: "ANALYTICAL_SIGNAL",
            executionOrder: false,
            asset: request.asset,
            providerId: request.providerId ?? null,
            providerSymbol: request.providerSymbol ?? null,
            sourceType: request.sourceType ?? null,
            lineage: { candleIds: request.candleIds ?? [], ensembleVersion: request.ensembleVersion ?? null, calibrationVersion: request.calibrationVersion ?? null, riskEvaluationId: request.riskEvaluationId ?? null },
            createdAt: createdAt.toISOString(),
            timeframe: request.timeframe,
            expiryDurationSeconds: request.expirySeconds,
            expiryTimestamp: new Date(createdAt.getTime() + request.expirySeconds * 1000).toISOString(),
            validUntilTimestamp: new Date(createdAt.getTime() + this.policy.validitySeconds * 1000).toISOString(),
            direction,
            state,
            rawModelProbability: representative?.probability ?? null,
            calibratedProbability,
            breakEvenProbability,
            probabilityDifference,
            modelAgreement: orchestration.agreement,
            marketRegime: request.regime,
            dataQualityScore: request.dataQualityScore,
            calibrationStatus: representative?.confidenceMetadata.calibrationStatus ?? "UNKNOWN",
            validationSampleSize: representative?.confidenceMetadata.sampleSize ?? 0,
            historicalValidationMetrics: { brierScore: null, logLoss: null, accuracy: null },
            uncertainty: representative?.confidenceMetadata.uncertainty ?? "HIGH",
            riskStatus: risk.status,
            simulatedExposure: risk.simulatedExposure,
            capitalAtRisk: risk.capitalAtRisk,
            maximumDrawdown: risk.maximumDrawdown,
            modelVersions: orchestration.evidence.map((item) => `${item.agentId}@${item.agentVersion}`),
            featureVersion: request.featureVersion,
            reason: this.reasonFor(state, orchestration.reason),
        };
    }
    evaluateTicks(features, now = Date.now(), lastSignalAt = null) {
        const direction = features.consecutiveDirection > 0 ? "UP" : features.consecutiveDirection < 0 ? "DOWN" : "NO_SIGNAL";
        const streak = Math.abs(features.consecutiveDirection);
        const aligned = direction !== "NO_SIGNAL" && features.velocity !== null && Math.sign(features.velocity) === Math.sign(features.consecutiveDirection);
        const stableVolatility = features.volatility !== null && features.volatility > 0 && features.volatility < 0.01;
        const confidence = Number(Math.min(0.99, Math.max(0, 0.5 + Math.min(streak, 8) * 0.045 + (aligned ? 0.12 : 0) + (stableVolatility ? 0.08 : 0))).toFixed(3));
        if (lastSignalAt !== null && now - lastSignalAt < 30_000)
            return { direction: "NO_SIGNAL", confidence, status: "BLOCKED", reason: "COOLDOWN_ACTIVE", asOfTimestamp: features.asOfTimestamp };
        if (features.sampleSize < 5 || streak < 4)
            return { direction: "NO_SIGNAL", confidence, status: "WAITING", reason: "INSUFFICIENT_TICK_SEQUENCE", asOfTimestamp: features.asOfTimestamp };
        if (!stableVolatility)
            return { direction: "NO_SIGNAL", confidence, status: "BLOCKED", reason: "VOLATILITY_OUT_OF_BOUNDS", asOfTimestamp: features.asOfTimestamp };
        if (confidence + 1e-9 < 0.88)
            return { direction: "NO_SIGNAL", confidence, status: "WAITING", reason: "CONFIDENCE_BELOW_THRESHOLD", asOfTimestamp: features.asOfTimestamp };
        return { direction, confidence, status: "QUALIFIED", reason: "MOMENTUM_GATE_PASSED", asOfTimestamp: features.asOfTimestamp };
    }
    gateState(request, result, risk, representative, breakEvenProbability) {
        if (request.dataQualityScore < this.policy.minimumDataQuality)
            return "DATA_QUALITY_WARNING";
        if (request.validationStatus !== "VALIDATED" || request.oosValidated !== true || request.walkForwardValidated !== true)
            return "INSUFFICIENT_EVIDENCE";
        if (request.horizonStatus !== "SELECTED")
            return "INSUFFICIENT_EVIDENCE";
        if ((request.behaviorContradictions ?? 0) > 0)
            return "HIGH_DISAGREEMENT";
        if (request.regime === "UNKNOWN" || request.regime === "ABNORMAL")
            return "UNKNOWN_REGIME";
        if (risk.status !== "ACCEPTABLE")
            return "NO_SIGNAL";
        if (result.direction === "NO_SIGNAL")
            return this.mapReason(result.reason);
        if (result.agreement < this.policy.minimumAgreement)
            return "HIGH_DISAGREEMENT";
        const minimumWinProbability = this.policy.minimumWinProbability ?? 0;
        if (minimumWinProbability > 0 && representative && representative.probability < minimumWinProbability)
            return "INSUFFICIENT_EVIDENCE";
        if (!representative || representative.validationStatus !== "VALID")
            return "INSUFFICIENT_EVIDENCE";
        if (representative.confidenceMetadata.sampleSize < this.policy.minimumValidationSample)
            return "INSUFFICIENT_EVIDENCE";
        if (representative.confidenceMetadata.calibrationStatus === "FAILED")
            return "CALIBRATION_FAILED";
        if (representative.confidenceMetadata.uncertainty === "HIGH")
            return "INSUFFICIENT_EVIDENCE";
        if (result.weightedProbability === null)
            return "INSUFFICIENT_EVIDENCE";
        if (Math.abs(result.weightedProbability - breakEvenProbability) < this.policy.minimumProbabilityEdge)
            return "WEAK_SIGNAL";
        return "VALID_SIGNAL";
    }
    representativeEvidence(evidence) {
        return [...evidence].sort((left, right) => right.confidenceMetadata.sampleSize - left.confidenceMetadata.sampleSize)[0];
    }
    mapReason(reason) {
        if (reason === "DATA_QUALITY_WARNING")
            return "DATA_QUALITY_WARNING";
        if (reason === "HIGH_DISAGREEMENT")
            return "HIGH_DISAGREEMENT";
        if (reason === "CALIBRATION_FAILED")
            return "CALIBRATION_FAILED";
        return "INSUFFICIENT_EVIDENCE";
    }
    reasonFor(state, orchestrationReason) {
        if (state === "VALID_SIGNAL" || state === "WEAK_SIGNAL")
            return null;
        return orchestrationReason ?? state;
    }
}
