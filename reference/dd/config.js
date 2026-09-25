import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function integer(name, value, fallback) {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0)
        throw new Error(`${name} must be a non-negative integer`);
    return parsed;
}
function asBoolean(value, fallback) {
    if (value === undefined)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off", ""].includes(normalized))
        return false;
    return fallback;
}
function asStringList(value, fallback) {
    if (!value)
        return fallback;
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
const defaultDerivSymbols = [
    "frxEURUSD",
    "frxGBPUSD",
    "frxUSDJPY",
    "frxAUDUSD",
    "frxUSDCAD",
    "frxUSDCHF",
    "frxNZDUSD",
    "frxEURGBP",
    "frxEURJPY",
    "frxGBPJPY",
    "frxAUDJPY",
    "frxEURAUD",
    "frxGBPAUD",
    "frxEURCAD",
    "frxGBPCAD",
    "frxAUDCAD",
    "frxUSDNOK",
    "frxUSDSEK",
    "frxUSDTRY",
    "frxUSDMXN",
    "frxUSDSGD",
    "frxUSDCNH",
    "frxUSDDKK",
    "frxUSDHKD",
    "R_10",
    "R_25",
    "R_50",
    "R_75",
    "R_100",
    "R_200",
    "R_300",
    "R_500",
];
function resolveEnv(env = process.env) {
    const merged = { ...process.env, ...env };
    if (env !== process.env)
        return merged;
    const envPath = join(process.cwd(), ".env");
    if (!existsSync(envPath))
        return merged;
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex < 0)
            continue;
        const key = trimmed.slice(0, equalsIndex).trim();
        let value = trimmed.slice(equalsIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        merged[key] = value;
    }
    return merged;
}
export function loadConfig(env = process.env) {
    const resolved = resolveEnv(env);
    const nodeEnv = resolved.NODE_ENV ?? "development";
    if (!["development", "test", "staging", "production"].includes(nodeEnv))
        throw new Error("NODE_ENV is invalid");
    const databaseUrl = resolved.DATABASE_URL ?? null;
    if (nodeEnv === "production" && databaseUrl === null)
        throw new Error("DATABASE_URL is required in production");
    const maxAgentConcurrency = integer("MAX_AGENT_CONCURRENCY", resolved.MAX_AGENT_CONCURRENCY, 10);
    if (maxAgentConcurrency < 1 || maxAgentConcurrency > 500)
        throw new Error("MAX_AGENT_CONCURRENCY must be between 1 and 500");
    const derivApiToken = resolved.DERIV_API_TOKEN ?? null;
    const derivAppId = resolved.DERIV_APP_ID ?? resolved.DERIV_APP ?? "1089";
    const derivEnabled = asBoolean(resolved.DERIV_ENABLED, asBoolean(resolved.MARKET_DERIV_ENABLED, true));
    const derivWsUrl = resolved.DERIV_WS_URL ?? resolved.MARKET_DERIV_WS_URL ?? "wss://api.derivws.com/trading/v1/options/ws/public";
    const derivTokens = [
        resolved.DERIV_TOKEN_1 ?? resolved.DERIV_API_TOKEN_1,
        resolved.DERIV_TOKEN_2 ?? resolved.DERIV_API_TOKEN_2,
        resolved.DERIV_TOKEN_3 ?? resolved.DERIV_API_TOKEN_3,
        resolved.DERIV_TOKEN_4 ?? resolved.DERIV_API_TOKEN_4,
    ]
        .map((token) => typeof token === "string" ? token.trim() : "")
        .filter((token) => Boolean(token));
    return {
        nodeEnv: nodeEnv,
        appName: resolved.APP_NAME ?? "EXISTING_PROJECT",
        appEnv: resolved.APP_ENV ?? nodeEnv,
        logLevel: resolved.LOG_LEVEL ?? "info",
        apiPrefix: resolved.API_PREFIX ?? "/api/v1",
        port: integer("PORT", resolved.PORT, 3001),
        redisUrl: resolved.REDIS_URL ?? null,
        databaseUrl,
        databasePoolMin: integer("DATABASE_POOL_MIN", resolved.DATABASE_POOL_MIN, 2),
        databasePoolMax: integer("DATABASE_POOL_MAX", resolved.DATABASE_POOL_MAX, 20),
        databaseSsl: asBoolean(resolved.DATABASE_SSL, false),
        runMigrations: asBoolean(resolved.RUN_MIGRATIONS, false),
        maxAgentConcurrency,
        agentTimeoutMs: integer("AGENT_TIMEOUT_MS", resolved.AGENT_TIMEOUT_MS, 1500),
        agentMaxRetries: integer("AGENT_MAX_RETRIES", resolved.AGENT_MAX_RETRIES, 1),
        redisRequired: nodeEnv === "production",
        binanceBaseUrl: resolved.BINANCE_BASE_URL ?? "https://api.binance.com",
        binanceEnabled: asBoolean(resolved.BINANCE_ENABLED, false),
        quotexEnabled: asBoolean(resolved.QUOTEX_ENABLED, false),
        pocketOptionEnabled: asBoolean(resolved.POCKET_OPTION_ENABLED, false),
        alimTradeEnabled: asBoolean(resolved.ALIMTRADE_ENABLED, false),
        otherBinaryOptionsEnabled: asBoolean(resolved.OTHER_BINARY_OPTIONS_ENABLED, false),
        oandaEnabled: asBoolean(resolved.OANDA_ENABLED, false),
        oandaBaseUrl: resolved.OANDA_BASE_URL ?? "https://api-fxpractice.oanda.com",
        oandaStreamUrl: resolved.OANDA_STREAM_URL ?? "https://stream-fxpractice.oanda.com",
        oandaAccountId: resolved.OANDA_ACCOUNT_ID ?? null,
        oandaApiToken: resolved.OANDA_API_TOKEN ?? null,
        finnhubEnabled: asBoolean(resolved.FINNHUB_ENABLED, false) || Boolean(resolved.FINNHUB_API_KEY),
        finnhubApiKey: resolved.FINNHUB_API_KEY ?? null,
        finnhubBaseUrl: resolved.FINNHUB_BASE_URL ?? "https://finnhub.io/api/v1",
        finnhubWebSocketUrl: resolved.FINNHUB_WS_URL ?? "wss://ws.finnhub.io",
        derivEnabled,
        derivAppId: derivAppId ?? null,
        derivApiToken,
        derivTokens,
        derivWsUrl,
        derivReconnect: asBoolean(resolved.DERIV_RECONNECT, true),
        derivTimeoutMs: integer("DERIV_TIMEOUT_MS", resolved.DERIV_TIMEOUT_MS, 10000),
        derivSymbols: asStringList(resolved.DERIV_SYMBOLS, defaultDerivSymbols),
        marketDerivEnabled: asBoolean(resolved.MARKET_DERIV_ENABLED, derivEnabled),
        marketDerivWsEnabled: asBoolean(resolved.MARKET_DERIV_WS_ENABLED, derivEnabled),
        marketDerivWsUrl: resolved.MARKET_DERIV_WS_URL ?? derivWsUrl,
        marketDerivSourceId: resolved.MARKET_DERIV_SOURCE_ID ?? "DERIV",
        marketDerivDataType: resolved.MARKET_DERIV_DATA_TYPE ?? "PUBLIC_WS_MARKET_DATA",
        marketDerivMarketType: resolved.MARKET_DERIV_MARKET_TYPE ?? "OTC_FOREX",
        marketDerivVerificationStatus: resolved.MARKET_DERIV_VERIFICATION_STATUS ?? "PUBLIC_MODE",
        marketDerivOfficialApi: asBoolean(resolved.MARKET_DERIV_OFFICIAL_API, true),
        marketDerivPermittedInterface: asBoolean(resolved.MARKET_DERIV_PERMITTED_INTERFACE, true),
        marketDerivReconnect: asBoolean(resolved.MARKET_DERIV_RECONNECT, true),
        marketDerivReconnectDelayMs: integer("MARKET_DERIV_RECONNECT_DELAY_MS", resolved.MARKET_DERIV_RECONNECT_DELAY_MS, 3000),
        marketDerivMaxReconnectAttempts: integer("MARKET_DERIV_MAX_RECONNECT_ATTEMPTS", resolved.MARKET_DERIV_MAX_RECONNECT_ATTEMPTS, 20),
        marketDerivSymbols: asStringList(resolved.MARKET_DERIV_SYMBOLS, asStringList(resolved.DERIV_SYMBOLS, defaultDerivSymbols)),
        marketDerivTimeframes: asStringList(resolved.MARKET_DERIV_TIMEFRAMES, ["1m", "5m", "15m", "30m", "1h"]),
        marketDerivAllowSignalInput: asBoolean(resolved.MARKET_DERIV_ALLOW_SIGNAL_INPUT, true),
        marketDerivAllowTrainingInput: asBoolean(resolved.MARKET_DERIV_ALLOW_TRAINING_INPUT, true),
        marketDerivAllowProductionData: asBoolean(resolved.MARKET_DERIV_ALLOW_PRODUCTION_DATA, true),
        marketDerivExecutionEnabled: asBoolean(resolved.MARKET_DERIV_EXECUTION_ENABLED, false),
        brokerExecutionEnabled: asBoolean(resolved.BROKER_EXECUTION_ENABLED, false),
        localMarketWsEnabled: asBoolean(resolved.LOCAL_MARKET_WS_ENABLED, false),
        localMarketWsUrl: resolved.LOCAL_MARKET_WS_URL ?? "ws://localhost:8080",
    };
}
