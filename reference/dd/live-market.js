export const DEFAULT_LOCAL_MARKET_WS_URL = "ws://localhost:8080";
const SUPPORTED_SYMBOLS = new Set([
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "AUD/USD",
    "USD/CAD",
    "USD/CHF",
    "NZD/USD",
]);
const SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h"]);
export function resolveLocalMarketWsUrl(configuredUrl) {
    const candidate = (configuredUrl ?? process.env.LOCAL_MARKET_WS_URL ?? DEFAULT_LOCAL_MARKET_WS_URL).trim();
    return candidate || DEFAULT_LOCAL_MARKET_WS_URL;
}
export function normalizeMarketMessage(rawMessage) {
    if (!rawMessage || typeof rawMessage !== "object")
        return null;
    const message = rawMessage;
    const payload = (() => {
        if (message.payload && typeof message.payload === "object")
            return message.payload;
        return message;
    })();
    if (!payload || typeof payload !== "object")
        return null;
    const asRecord = (value) => (value && typeof value === "object" ? value : null);
    const ohlc = asRecord(payload.ohlc);
    const candle = asRecord(payload.candle);
    const symbol = typeof payload.symbol === "string" ? payload.symbol.trim() : typeof payload.asset === "string" ? payload.asset.trim() : "";
    const timeframe = typeof payload.timeframe === "string" ? payload.timeframe.trim().toLowerCase() : "1m";
    const timestampValue = payload.timestamp ?? payload.time ?? payload.last_updated ?? null;
    const timestampMs = timestampValue ? new Date(String(timestampValue)).getTime() : Number.NaN;
    const open = Number(payload.open ?? ohlc?.open ?? candle?.open ?? NaN);
    const high = Number(payload.high ?? ohlc?.high ?? candle?.high ?? NaN);
    const low = Number(payload.low ?? ohlc?.low ?? candle?.low ?? NaN);
    const close = Number(payload.close ?? ohlc?.close ?? candle?.close ?? NaN);
    if (!symbol || !SUPPORTED_SYMBOLS.has(symbol) || !SUPPORTED_TIMEFRAMES.has(timeframe))
        return null;
    if (![open, high, low, close].every(Number.isFinite))
        return null;
    if (open > high || low > high || open < low || close > high || close < low)
        return null;
    if (!Number.isFinite(timestampMs) || timestampMs > Date.now() + 60_000)
        return null;
    return {
        symbol,
        timestamp: new Date(timestampMs).toISOString(),
        timeframe,
        open,
        high,
        low,
        close,
        source: typeof payload.source === "string" ? payload.source : "DERIV",
    };
}
