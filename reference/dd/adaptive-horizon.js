export class AdaptiveHorizonSelector {
    supportedHorizons;
    constructor(supportedHorizons = [1, 5, 10, 15, 30, 60]) {
        this.supportedHorizons = supportedHorizons;
    }
    select(evidence) {
        const candidates = evidence.filter((item) => this.supportedHorizons.includes(item.horizonMinutes));
        const eligible = candidates.filter((item) => item.sampleSize >= 100 && item.outOfSampleScore !== null && item.walkForwardStability !== null && item.regimeCompatible && item.uncertainty !== "HIGH" && item.calibrationStatus === "VALIDATED");
        if (eligible.length === 0)
            return { selectedHorizonMinutes: null, status: candidates.length ? "NO_VALIDATED_HORIZON" : "INSUFFICIENT_DATA", candidates, reason: candidates.length ? "NO_HORIZON_PASSED_VALIDATION_GATES" : "NO_HORIZON_EVIDENCE" };
        const selected = [...eligible].sort((left, right) => (right.outOfSampleScore + right.walkForwardStability) - (left.outOfSampleScore + left.walkForwardStability))[0];
        return { selectedHorizonMinutes: selected.horizonMinutes, status: "SELECTED", candidates, reason: "VALIDATED_HORIZON_SELECTED" };
    }
}
