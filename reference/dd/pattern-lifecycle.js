export function nextPatternLifecycle(current, evidence) {
    if (current === "RETIRED")
        return "RETIRED";
    if (evidence.deteriorationPersisted)
        return "RETIRED";
    if (evidence.performanceDeteriorated)
        return current === "DEGRADED" ? "UNDER_REVIEW" : "DEGRADED";
    if (current === "DISCOVERED" && evidence.repeatedObservations > 1)
        return "CANDIDATE";
    if (current === "CANDIDATE" && evidence.repeatedObservations >= 30)
        return "BACKTESTING";
    if (current === "BACKTESTING" && evidence.backtestPassed)
        return "OOS_TESTING";
    if (current === "OOS_TESTING" && evidence.oosPassed && evidence.walkForwardPassed)
        return "VALIDATED";
    if (current === "VALIDATED" && evidence.calibrationPassed && evidence.uncertainty !== "HIGH")
        return "ACTIVE";
    return current;
}
export function lifecycleFromValidation(result, evidence) {
    return nextPatternLifecycle(result.lifecycle, { ...evidence, calibrationPassed: result.status === "VALIDATED" && evidence.calibrationPassed });
}
