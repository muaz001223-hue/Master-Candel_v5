import { createServer } from "node:http";
import { AgentOrchestrator } from "./agents/orchestrator.js";
import { AgentRegistry } from "./agents/registry.js";
import { createSpecializedAgents } from "./agents/specialized.js";
import { BinarySignalEngine } from "./signal-engine.js";
import { loadConfig } from "./config.js";
import { DatabaseClient } from "./database/client.js";
import { BehaviorValidationRepository, SignalRepository } from "./database/repositories.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RedisJobStore } from "./jobs/queue.js";
import { ProviderRegistry } from "./market/providers.js";
import { InstrumentRegistry } from "./market/instrument-registry.js";
import { LiveProviderBridge } from "./market/live-provider-bridge.js";
import { BrowserObservationManager } from "./market/browser-observation.js";
import { DashboardRelay } from "./market/dashboard-relay.js";
const registry = new AgentRegistry();
for (const agent of createSpecializedAgents())
    registry.register(agent);
const config = loadConfig();
const orchestrator = new AgentOrchestrator(registry, { maxConcurrency: config.maxAgentConcurrency });
const signalEngine = new BinarySignalEngine();
const database = config.databaseUrl ? new DatabaseClient(config) : null;
const signalRepository = database ? new SignalRepository(database) : null;
const behaviorValidationRepository = database ? new BehaviorValidationRepository(database) : null;
const providerRegistry = ProviderRegistry.fromConfig(config);
const provider = providerRegistry.get("binance").adapter;
const instrumentRegistry = new InstrumentRegistry();
const dashboardRelay = new DashboardRelay(8080);
const liveProviderBridge = config.derivEnabled ? new LiveProviderBridge(config, registry, orchestrator, dashboardRelay) : null;
let derivUniverseSubscription = null;
const browserObservation = new BrowserObservationManager(orchestrator);
const redis = config.redisUrl ? new RedisJobStore(config.redisUrl) : null;
let redisConnectionAttempted = false;
function derivLiveInstruments() {
    const receivedSymbols = new Set(liveProviderBridge?.diagnostics.DERIV.symbols ?? []);
    return config.derivSymbols.map((symbol) => {
        const [baseAsset = symbol, quoteAsset = ""] = symbol.split("/");
        const received = receivedSymbols.has(symbol);
        return {
            instrumentId: `deriv-${symbol.replace("/", "-").toLowerCase()}`,
            symbol,
            baseAsset,
            quoteAsset,
            provider: "deriv",
            providerId: "DERIV",
            providerSymbol: symbol,
            sourceType: "REFERENCE_MARKET_SOURCE",
            status: "ACTIVE",
            availability: received,
            latestPrice: liveProviderBridge ? (dashboardRelay.latest(symbol)?.close ?? null) : null,
            latestTimestamp: liveProviderBridge ? (dashboardRelay.latest(symbol)?.timestamp ?? null) : null,
            supportedTimeframes: ["1m"],
            dataSource: "deriv-live-stream",
            firstSeen: null,
            lastSeen: received ? new Date().toISOString() : null,
            timezone: "UTC",
            metadata: { liveProvider: "DERIV", streamStatus: received ? "RECEIVING" : "WAITING" },
        };
    });
}
async function derivInstruments() {
    const deriv = providerRegistry.get("deriv");
    if (!deriv || !config.derivEnabled || !deriv.adapter.configured)
        return [];
    const discovered = await deriv.adapter.discoverInstruments();
    return discovered.map((instrument) => {
        const latest = dashboardRelay.latest(instrument.providerSymbol) ?? dashboardRelay.latest(instrument.symbol) ?? null;
        return {
            instrumentId: `deriv-${instrument.providerSymbol}`,
            symbol: instrument.symbol,
            baseAsset: instrument.baseAsset,
            quoteAsset: instrument.quoteAsset,
            provider: "deriv",
            providerId: "DERIV",
            providerSymbol: instrument.providerSymbol,
            sourceType: "REFERENCE_MARKET_SOURCE",
            status: "ACTIVE",
            availability: Boolean(latest || instrument.providerSymbol),
            latestPrice: latest?.close ?? null,
            latestTimestamp: latest?.timestamp ?? null,
            supportedTimeframes: instrument.supportedTimeframes,
            dataSource: instrument.dataSource,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            timezone: instrument.timezone ?? "UTC",
            metadata: { liveProvider: "DERIV", streamStatus: latest ? "RECEIVING" : "WAITING" },
        };
    });
}
async function readiness() {
    let databaseReady = false;
    if (database) {
        try {
            await database.healthcheck();
            databaseReady = true;
        }
        catch {
            databaseReady = false;
        }
    }
    let redisReady = false;
    if (redis) {
        try {
            if (!redisConnectionAttempted) {
                await redis.connect();
                redisConnectionAttempted = true;
            }
            redisReady = await redis.healthcheck();
        }
        catch {
            redisReady = false;
        }
    }
    const derivHealth = liveProviderBridge?.providerHealth();
    const configuredProviderHealth = derivHealth ?? (await providerRegistry.health()).find((item) => item.configured) ?? await provider.healthcheck();
    const providerReady = configuredProviderHealth.available;
    return {
        database: databaseReady,
        redis: redisReady,
        redisRequired: config.redisRequired,
        providerReady,
        provider: derivHealth ? "deriv" : configuredProviderHealth.provider,
        providerState: configuredProviderHealth.state ?? configuredProviderHealth.status ?? "UNKNOWN",
    };
}
function json(response, status, body) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "cache-control": "no-store", "x-request-id": randomUUID() });
    response.end(JSON.stringify(body));
}
async function body(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function isAnalysisRequest(value) {
    if (!value || typeof value !== "object")
        return false;
    const input = value;
    return ["asset", "timeframe", "datasetVersion", "featureVersion", "regime"].every((key) => typeof input[key] === "string")
        && typeof input.expirySeconds === "number"
        && typeof input.dataQualityScore === "number";
}
function isRiskContext(value) {
    if (!value || typeof value !== "object")
        return false;
    const input = value;
    return (input.status === "ACCEPTABLE" || input.status === "RESTRICTED" || input.status === "BLOCKED")
        && typeof input.simulatedExposure === "number"
        && typeof input.capitalAtRisk === "number"
        && (typeof input.maximumDrawdown === "number" || input.maximumDrawdown === null);
}
export const server = createServer(async (request, response) => {
    try {
        if (request.method === "GET" && request.url === "/health") {
            json(response, 200, { status: "ok", registrySize: registry.size() });
            return;
        }
        if (request.method === "GET" && request.url === "/ready") {
            const state = await readiness();
            const ready = state.database && (!state.redisRequired || state.redis) && state.providerReady;
            json(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", ...state, reason: ready ? null : "REQUIRED_SERVICE_UNAVAILABLE" });
            return;
        }
        if (request.method === "GET" && request.url === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
            response.end(await readFile(join(process.cwd(), "public", "trading-chart.html"), "utf8"));
            return;
        }
        if (request.method === "GET" && request.url === "/js/quotex-ui.js") {
            response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
            response.end(await readFile(join(process.cwd(), "public", "js", "quotex-ui.js"), "utf8"));
            return;
        }
        if (request.method === "GET" && request.url === "/js/browser-observation.js") {
            response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
            response.end(await readFile(join(process.cwd(), "public", "js", "browser-observation.js"), "utf8"));
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/runtime") {
            const agents = registry.list();
            const activeAgents = agents.filter((agent) => agent.status === "ACTIVE" || agent.status === "DEGRADED");
            json(response, 200, {
                providers: [liveProviderBridge?.providerHealth() ? { ...liveProviderBridge.providerHealth(), id: "deriv", dataIdentity: "deriv-market-data", configured: true, category: "DERIV_MARKET_DATA", sourceType: "REFERENCE_MARKET_SOURCE" } : null, ...(await providerRegistry.health())].filter((item) => item !== null),
                observation: browserObservation.snapshot(),
                agents: { registered: agents.length, implemented: activeAgents.filter((agent) => agent.version !== "adapter-0.1.0").length, active: activeAgents.length, underReview: agents.filter((agent) => agent.status === "UNDER_REVIEW").length, maxConcurrency: config.maxAgentConcurrency },
                masterAgent: { status: liveProviderBridge?.diagnostics.MASTER_AGENT.status ?? "DEGRADED", lastDecision: liveProviderBridge?.diagnostics.MASTER_AGENT.last_decision ?? null, decisionTimestamp: liveProviderBridge?.diagnostics.MASTER_AGENT.decision_timestamp ?? null, reason: liveProviderBridge?.diagnostics.MASTER_AGENT.reason ?? null },
                signalEngine: { status: "CONFIGURED", executionEnabled: false },
                moneyManagement: { status: "SEPARATE_SIMULATION_ONLY" },
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/chart/diagnostics") {
            json(response, 200, {
                provider: liveProviderBridge?.diagnostics.DERIV ?? null,
                agentConsensus: liveProviderBridge?.diagnostics.AGENT_ENGINE.last_consensus ?? null,
                relay: dashboardRelay.snapshot().map((candle) => ({ symbol: candle.symbol, timeframe: candle.timeframe, timestamp: candle.timestamp, close: candle.close })),
                chartDataAgeMs: liveProviderBridge?.diagnostics.DERIV.last_tick ? Math.max(0, Date.now() - Date.parse(liveProviderBridge.diagnostics.DERIV.last_tick)) : null,
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/agents") {
            json(response, 200, { items: registry.list().map((agent) => ({ id: agent.id, role: agent.role, version: agent.version, status: agent.status, capabilities: agent.capabilities })) });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/observation") {
            json(response, 200, browserObservation.snapshot());
            return;
        }
        const behaviorRoute = request.url?.match(/^\/api\/v1\/market-behavior\/([^/]+)$/);
        if (request.method === "GET" && behaviorRoute) {
            const behavior = browserObservation.snapshot().behavior;
            if (!behavior || behavior.pair !== decodeURIComponent(behaviorRoute[1])) {
                json(response, 200, { status: "NO_DATA", item: null });
                return;
            }
            json(response, 200, { status: "READY", item: behavior });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/pattern-validation") {
            if (!behaviorValidationRepository) {
                json(response, 200, { status: "NOT_CONFIGURED", items: [] });
                return;
            }
            try {
                json(response, 200, { status: "READY", items: await behaviorValidationRepository.list() });
            }
            catch {
                json(response, 503, { status: "NO_DATA", items: [], reason: "DATABASE_UNAVAILABLE" });
            }
            return;
        }
        if (request.method === "GET" && ["/api/v1/behavior-evidence", "/api/v1/patterns", "/api/v1/sequences", "/api/v1/price-levels", "/api/v1/regime-transitions", "/api/v1/behavior-matches"].includes(request.url ?? "")) {
            const behavior = browserObservation.snapshot().behavior;
            const items = behavior ? [...behavior.patternMatches, ...behavior.sequenceMatches, ...behavior.priceLevelEvidence, ...behavior.temporalEvidence, ...behavior.regimeEvidence, ...behavior.movementEvidence, ...behavior.discoveredPatternEvidence] : [];
            json(response, 200, { status: items.length ? "READY" : "NO_DATA", items });
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/open") {
            const input = await body(request);
            if (typeof input.provider !== "string" || typeof input.providerUrl !== "string") {
                json(response, 400, { error: "INVALID_OBSERVATION_WORKSPACE" });
                return;
            }
            json(response, 200, browserObservation.openWorkspace(input.provider, input.providerUrl));
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/start") {
            const input = await body(request);
            if (typeof input.provider !== "string" || typeof input.providerUrl !== "string" || input.userConfirmedLogin !== true) {
                json(response, 400, { error: "USER_LOGIN_CONFIRMATION_REQUIRED" });
                return;
            }
            const snapshot = browserObservation.snapshot();
            if (snapshot.observation === "OBSERVING" && snapshot.observationSessionId) {
                json(response, 200, { ...snapshot, reason: "OBSERVATION_ALREADY_ACTIVE" });
                return;
            }
            json(response, 200, browserObservation.start(input.provider, input.providerUrl, true));
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/stop") {
            json(response, 200, browserObservation.stop());
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/close") {
            json(response, 200, browserObservation.closeBrowser());
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/pairs") {
            const input = await body(request);
            if (!Array.isArray(input.pairs)) {
                json(response, 400, { error: "INVALID_OBSERVED_PAIRS" });
                return;
            }
            json(response, 200, await browserObservation.discover(input.pairs.filter((pair) => Boolean(pair && typeof pair === "object" && typeof pair.symbol === "string"))));
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/event") {
            const input = await body(request);
            const event = input;
            if (["symbol", "timeframe", "timestamp", "closeTimestamp"].some((key) => typeof input[key] !== "string") || ["open", "high", "low", "close"].some((key) => typeof input[key] !== "number")) {
                json(response, 400, { error: "INVALID_OBSERVED_MARKET_EVENT" });
                return;
            }
            json(response, 200, await browserObservation.observe(event));
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/observation/tick") {
            const input = await body(request);
            if (typeof input.symbol !== "string" || typeof input.timestamp !== "string" || typeof input.price !== "number") {
                json(response, 400, { error: "INVALID_OBSERVED_TICK" });
                return;
            }
            json(response, 200, await browserObservation.observeTick({
                symbol: input.symbol,
                price: input.price,
                timestamp: input.timestamp,
                ...(typeof input.providerSymbol === "string" ? { providerSymbol: input.providerSymbol } : {}),
                ...(typeof input.timeframe === "string" ? { timeframe: input.timeframe } : {}),
            }));
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/provider/health") {
            json(response, 200, await provider.healthcheck());
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/providers") {
            const registeredProviders = await providerRegistry.health();
            const derivStatus = liveProviderBridge?.providerHealth() ?? {
                provider: "deriv",
                available: false,
                status: "NOT_CONFIGURED",
                state: "NOT_CONFIGURED",
                latencyMs: null,
                freshnessSeconds: null,
                errorRate: 1,
                qualityScore: 0,
                lastChecked: new Date().toISOString(),
            };
            json(response, 200, { items: [{ ...derivStatus, id: "deriv", dataIdentity: "deriv-market-data", configured: derivStatus.status !== "NOT_CONFIGURED", category: "DERIV_MARKET_DATA", sourceType: "REFERENCE_MARKET_SOURCE" }, ...registeredProviders] });
            return;
        }
        const providerRoute = request.url?.match(/^\/api\/v1\/providers\/([^/]+)(?:\/(health|instruments|timeframes))?$/);
        if (request.method === "GET" && providerRoute) {
            const providerId = providerRoute[1];
            const descriptor = providerRegistry.get(providerId);
            if (!descriptor) {
                json(response, 404, { error: "PROVIDER_NOT_FOUND" });
                return;
            }
            const action = providerRoute[2];
            if (action === "health") {
                json(response, 200, await descriptor.adapter.healthCheck());
                return;
            }
            if (action === "timeframes") {
                json(response, 200, { providerId, items: await descriptor.adapter.getSupportedTimeframes(), capabilities: descriptor.adapter.capabilities });
                return;
            }
            if (action === "instruments") {
                if (!descriptor.adapter.configured) {
                    json(response, 200, { providerId, items: [], status: descriptor.adapter.capabilities.availability });
                    return;
                }
                json(response, 200, { providerId, items: instrumentRegistry.discover(await descriptor.adapter.discoverInstruments()), status: "ACTIVE" });
                return;
            }
            json(response, 200, { ...descriptor, adapter: undefined, capabilities: descriptor.adapter.capabilities });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/instruments") {
            const items = [
                ...(config.derivEnabled ? derivLiveInstruments() : []),
                ...(config.derivEnabled ? await derivInstruments() : []),
            ];
            if (items.length) {
                json(response, 200, { items, status: "READY", provider: "multi-provider" });
                return;
            }
            if (!provider.configured) {
                json(response, 200, { items: [], status: "PROVIDER_NOT_CONFIGURED", provider: provider.name });
                return;
            }
            const discovered = instrumentRegistry.discover(await provider.discoverInstruments());
            json(response, 200, { items: discovered, status: "READY", provider: provider.name });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/models") {
            json(response, 200, { items: [], status: "NOT_AVAILABLE", reason: "NO_MODEL_REGISTRY_INSTANCE_CONFIGURED" });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/signals/history") {
            if (!signalRepository) {
                json(response, 200, { items: [], status: "NOT_CONFIGURED", reason: "DATABASE_NOT_CONFIGURED" });
                return;
            }
            try {
                json(response, 200, { items: await signalRepository.list(), status: "READY" });
            }
            catch {
                json(response, 503, { items: [], status: "NO_DATA", reason: "DATABASE_UNAVAILABLE" });
            }
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/opportunities/top") {
            json(response, 200, {
                status: "NO_QUALIFIED_SIGNAL",
                items: [],
                qualifiedPairCount: 0,
                lastUpdated: null,
                source: "qualification-engine",
                message: "NO_QUALIFIED_PAIRS_AVAILABLE",
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/signals/performance") {
            json(response, 200, {
                status: "NO_VALIDATED_HISTORY",
                totalSignals: 0,
                wins: 0,
                losses: 0,
                pending: 0,
                winRate: null,
                lossRate: null,
                lastSignal: null,
                lastUpdated: null,
                validationStatus: "NOT_VALIDATED",
                source: "signal-perf-history",
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/simulation/performance") {
            json(response, 200, {
                status: "SIMULATION_ONLY",
                simulationStatus: "SIMULATION_ONLY",
                totalTests: 0,
                wins: 0,
                losses: 0,
                pending: 0,
                winRate: null,
                lossRate: null,
                currentTestRun: null,
                validationStatus: "NOT_VALIDATED",
                lastUpdated: null,
                source: "paper-simulation",
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/signals/output") {
            json(response, 200, {
                signalId: null,
                pair: null,
                direction: "NO_SIGNAL",
                probability: null,
                validatedAccuracy: null,
                timeframe: null,
                horizon: null,
                dataQuality: null,
                regime: null,
                evidence: [],
                status: "NO_QUALIFIED_SIGNAL",
                timestamp: null,
                validationStatus: "NOT_VALIDATED",
                source: "signal-engine",
            });
            return;
        }
        if (request.method === "GET" && request.url === "/api/v1/quotex/status") {
            json(response, 200, {
                provider: "quotex",
                providerStatus: "NOT_VERIFIED",
                dataStatus: "NOT_AVAILABLE",
                pipelineStatus: "BLOCKED",
                qualifiedPairs: [],
                masterStatus: "NO_SIGNAL",
                moduleStatus: "NOT_VERIFIED",
                lastUpdated: new Date().toISOString(),
                reason: "QUOTEX_NOT_VERIFIED_OR_UNAVAILABLE",
            });
            return;
        }
        const chartRoute = request.url?.match(/^\/api\/v1\/chart\/(.+)$/);
        if (request.method === "GET" && chartRoute) {
            const rawPath = chartRoute[1] ?? "";
            const pairName = decodeURIComponent(rawPath.split("?")[0] ?? "").replace(/\/+$/, "");
            const targetUrl = request.url ?? "/";
            const chartUrl = new URL(targetUrl, "http://127.0.0.1");
            const timeframe = chartUrl.searchParams.get("timeframe") ?? "1m";
            json(response, 200, {
                pair: pairName || null,
                provider: "DERIV",
                timeframe,
                candles: [],
                lastUpdate: null,
                dataStatus: "NO_DATA",
                qualificationStatus: "WAITING",
                source: "live-candle-store",
            });
            return;
        }
        if (request.method === "POST" && request.url === "/api/v1/analysis") {
            const input = await body(request);
            if (!isAnalysisRequest(input)) {
                json(response, 400, { error: "INVALID_ANALYSIS_REQUEST" });
                return;
            }
            const orchestration = await orchestrator.analyze(input);
            const rawInput = input;
            const risk = isRiskContext(rawInput.risk)
                ? rawInput.risk
                : { status: "BLOCKED", simulatedExposure: 0, capitalAtRisk: 0, maximumDrawdown: null };
            const signal = signalEngine.evaluate(input, orchestration, risk);
            if (signalRepository)
                await signalRepository.create(signal);
            json(response, 200, signal);
            return;
        }
        json(response, 404, { error: "NOT_FOUND" });
    }
    catch {
        json(response, 500, { error: "INTERNAL_ERROR" });
    }
});
const isDirectExecution = () => {
    if (!process.argv[1])
        return false;
    return import.meta.url === pathToFileURL(process.argv[1]).href;
};
if (config.nodeEnv !== "test" && isDirectExecution()) {
    dashboardRelay.start();
    const stopLiveProviderBridge = liveProviderBridge?.start() ?? (() => undefined);
    const startDerivUniverse = async () => {
        const deriv = providerRegistry.get("deriv");
        if (!config.derivEnabled || !deriv || !deriv.adapter.configured)
            return () => undefined;
        const discovered = await deriv.adapter.discoverInstruments();
        const instruments = instrumentRegistry.discover(discovered);
        const unsubscribers = [];
        for (const instrument of instruments) {
            try {
                const stop = await deriv.adapter.subscribeTicks(instrument, async (tick) => {
                    const event = {
                        providerId: "DERIV",
                        symbol: instrument.providerSymbol,
                        price: tick.price,
                        timestamp: tick.sourceTimestamp || new Date().toISOString(),
                        sourceTimestamp: tick.sourceTimestamp || new Date().toISOString(),
                        metadata: { provider: "DERIV", source: "MULTI_CONNECTION_WS" },
                    };
                    dashboardRelay.publishTick(event);
                });
                unsubscribers.push(stop);
            }
            catch (error) {
                console.warn("DERIV_SUBSCRIBE_FAILED", instrument.providerSymbol, error);
            }
        }
        return () => { for (const stop of unsubscribers)
            stop(); };
    };
    void startDerivUniverse().then((stop) => {
        derivUniverseSubscription = stop;
    });
    server.listen(config.port, () => console.log(`analysis api listening on ${config.port}`));
    const shutdown = async () => {
        stopLiveProviderBridge();
        derivUniverseSubscription?.();
        server.close();
        if (database)
            await database.close();
        if (redis)
            await redis.close();
    };
    process.once("SIGTERM", () => { void shutdown(); });
    process.once("SIGINT", () => { void shutdown(); });
}
