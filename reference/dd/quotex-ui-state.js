export function normalizeProviderStatus(status) {
    if (!status)
        return "NOT_CONFIGURED";
    const mapped = String(status).toUpperCase();
    if (["CONNECTED", "ACTIVATED", "ACTIVE", "READY"].includes(mapped))
        return "CONNECTED";
    if (["DEGRADED", "RATE_LIMITED", "PARTIAL"].includes(mapped))
        return "DEGRADED";
    if (mapped === "NOT_VERIFIED")
        return "NOT_VERIFIED";
    if (["UNVERIFIED", "UNKNOWN"].includes(mapped))
        return "UNVERIFIED";
    if (["NOT_SUPPORTED", "NOT_AVAILABLE", "UNSUPPORTED"].includes(mapped))
        return "NOT_CONFIGURED";
    if (["DISCONNECTED", "OFFLINE"].includes(mapped))
        return "DISCONNECTED";
    return "NOT_CONFIGURED";
}
export function resolveQuotexState(params) {
    const normalizedStatus = normalizeProviderStatus(params.status ?? "");
    if (params.backendState === "BLOCKED" || normalizedStatus === "NOT_VERIFIED")
        return "BLOCKED";
    if (params.isDataReceiving && params.hasPermittedApi)
        return "DATA_RECEIVING";
    if (normalizedStatus === "CONNECTED" && params.hasPermittedApi && params.websiteOpened)
        return "CONNECTED_PERMITTED";
    if (normalizedStatus === "CONNECTED" && !params.hasPermittedApi)
        return "CONNECTED_UNVERIFIED";
    if (params.websiteOpened && params.userLoggedIn && !params.hasPermittedApi)
        return "USER_LOGIN_REQUIRED";
    if (params.websiteOpened && !params.userLoggedIn)
        return "OPENED";
    if (params.allowManualCheck && !params.websiteOpened)
        return "USER_LOGIN_REQUIRED";
    if (normalizedStatus === "DISCONNECTED")
        return "DISCONNECTED";
    if (normalizedStatus === "DEGRADED")
        return "DATA_STALE";
    if (normalizedStatus === "NOT_CONFIGURED")
        return "NOT_CONNECTED";
    return "NOT_CONNECTED";
}
