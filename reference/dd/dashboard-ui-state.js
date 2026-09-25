function normalizeText(value, fallback = "N/A") {
    if (value == null || value === "")
        return fallback;
    return String(value).trim() || fallback;
}
function normalizeStatus(value, fallback = "WAITING") {
    const label = normalizeText(value, fallback).toUpperCase();
    if (label === "OK" || label === "READY" || label === "LIVE" || label === "AVAILABLE")
        return "READY";
    if (label === "WAITING" || label === "NO_DATA" || label === "NOT_AVAILABLE" || label === "NOT_CONFIGURED")
        return "WAITING";
    if (label === "BLOCKED" || label === "NOT_VERIFIED" || label === "USER_LOGIN_REQUIRED")
        return "BLOCKED";
    if (label === "ERROR" || label === "BROKEN")
        return "ERROR";
    return label;
}
export function summarizeDashboardState(input) {
    const instruments = Array.isArray(input.instruments) ? input.instruments : [];
    const providers = Array.isArray(input.providers) ? input.providers : [];
    const runtime = input.runtime ?? {};
    const maxPairs = Math.max(1, input.maxPairs ?? 10);
    const quotex = providers.find((provider) => {
        const id = String(provider.id ?? provider.provider ?? "").toLowerCase();
        return id.includes("quotex");
    }) ?? {
        id: "quotex",
        provider: "quotex",
        status: "NOT_VERIFIED",
        state: "BLOCKED",
        available: false,
        configured: false,
    };
    const quotexStatus = String(quotex.state ?? quotex.status ?? "BLOCKED").toUpperCase();
    const activePairs = instruments.filter((pair) => {
        const availability = pair.availability;
        const isAvailable = availability === true || availability === "true" || availability === "AVAILABLE" || availability === "RECEIVING";
        return isAvailable && pair.symbol;
    }).slice(0, maxPairs);
    const opportunities = {
        count: activePairs.length,
        empty: activePairs.length === 0,
        items: activePairs.map((pair) => ({
            pair: normalizeText(pair.symbol, "N/A"),
            timeframe: "N/A",
            qualificationStatus: "WAITING",
            signalProbability: "N/A",
            validatedAccuracy: "N/A",
            dataQuality: "N/A",
            regime: "N/A",
            confidence: "N/A",
            lastUpdated: normalizeText(pair.latestTimestamp, "N/A"),
            source: normalizeText(pair.provider, "N/A"),
        })),
    };
    const performance = {
        empty: true,
        totalSignals: "N/A",
        wins: "N/A",
        losses: "N/A",
        pending: "N/A",
        winRate: "N/A",
        lossRate: "N/A",
        lastSignal: "N/A",
        lastUpdated: "N/A",
    };
    const internalTest = {
        empty: true,
        totalTests: "N/A",
        wins: "N/A",
        losses: "N/A",
        pending: "N/A",
        winRate: "N/A",
        lossRate: "N/A",
        currentRun: "N/A",
        validationStatus: "WAITING",
        simulationStatus: "NOT_AVAILABLE",
    };
    const runtimeMaster = runtime.masterAgent ?? {};
    const lastDecision = normalizeText(runtimeMaster.lastDecision, "NO_SIGNAL");
    const signalDirection = lastDecision === "NO_SIGNAL" ? "NO_SIGNAL" : lastDecision;
    const output = {
        empty: signalDirection === "NO_SIGNAL" || signalDirection === "WAITING" || signalDirection === "",
        signalId: "N/A",
        pair: "N/A",
        direction: signalDirection === "NO_SIGNAL" ? "NO_SIGNAL" : signalDirection,
        probability: "N/A",
        validatedAccuracy: "N/A",
        timeframe: "N/A",
        horizon: "N/A",
        status: "NO QUALIFIED SIGNAL",
        timestamp: normalizeText(runtimeMaster.decisionTimestamp, "N/A"),
    };
    const providerStatus = providers.find((provider) => {
        const id = String(provider.id ?? provider.provider ?? "").toLowerCase();
        return id.includes("deriv") || id === "deriv";
    });
    const marketStatus = providerStatus?.available === true ? "LIVE" : activePairs.length > 0 ? "ANALYZING" : "WAITING";
    return {
        opportunities,
        performance,
        internalTest,
        quotexStatus: normalizeStatus(quotexStatus, "BLOCKED"),
        marketStatus: normalizeStatus(marketStatus, "WAITING"),
        signalOutput: output,
    };
}
