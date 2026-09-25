import WebSocket from "ws";
import { AgentRegistry } from "../agents/registry.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";
import { createCapabilityAgent } from "../agents/catalog.js";
import { BinarySignalEngine } from "../signal-engine.js";
import { ProviderPriorityManager } from "./provider-priority.js";
export function selectFreeTierSymbols(symbols) {
    const cleaned = Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean)));
    const preferred = ["frxEURUSD", "frxGBPUSD", "frxUSDJPY", "frxAUDUSD", "frxUSDCAD"];
    const selected = preferred.filter((symbol) => cleaned.includes(symbol));
    for (const symbol of cleaned) {
        if (!selected.includes(symbol))
            selected.push(symbol);
    }
    return selected;
}
function displaySymbol(symbol) {
    const match = /^frx([A-Z]{6})$/.exec(symbol);
    const pair = match?.[1];
    return pair ? `${pair.slice(0, 3)}/${pair.slice(3)}` : symbol;
}
export class LiveProviderBridge {
    dashboardRelay;
    priorityManager;
    diagnostics = {
        DERIV: { connection: "DISCONNECTED", last_tick: null, last_provider_message: null, symbols: [], subscribed_symbols: [], subscription_ack: false, reconnect_count: 0, tick_rate: 0, latency: null },
        AGENT_ENGINE: { active_agents: 0, processing_agents: 0, completed_agents: 0, failed_agents: 0, average_latency: 0, last_consensus: null },
        MASTER_AGENT: { status: "DEGRADED", last_decision: null, decision_timestamp: null, reason: null },
    };
    registry;
    orchestrator;
    signalEngine = new BinarySignalEngine({ minimumAgreement: 0.9, minimumWinProbability: 0.85 });
    config;
    tickHistory = [];
    ws = null;
    stopListener = null;
    reconnectTimer = null;
    reconnectDelayMs = 1000;
    stopping = false;
    discoveredSymbols;
    constructor(config, registry, orchestrator, dashboardRelay) {
        this.dashboardRelay = dashboardRelay;
        this.config = config;
        this.discoveredSymbols = selectFreeTierSymbols(config.derivSymbols);
        this.registry = registry ?? new AgentRegistry();
        if (this.registry.size() === 0) {
            this.registry.register(createCapabilityAgent("baseline-logistic", "logistic-regression", ["model.logistic"]));
            this.registry.register(createCapabilityAgent("baseline-statistical", "statistical-model", ["model.statistical"]));
            this.registry.register(createCapabilityAgent("data-quality", "data-quality", ["data.quality"]));
            this.registry.register(createCapabilityAgent("trend-analysis", "trend-analysis", ["analysis.trend", "feature.momentum", "feature.regime"]));
            this.registry.register(createCapabilityAgent("range-analysis", "range-analysis", ["analysis.range", "feature.volatility"]));
        }
        this.orchestrator = orchestrator ?? new AgentOrchestrator(this.registry, { maxConcurrency: Math.min(config.maxAgentConcurrency || 10, 500) });
        this.priorityManager = new ProviderPriorityManager([
            { id: "DERIV", name: "Deriv", configured: Boolean(config.derivEnabled), available: Boolean(config.derivEnabled), priority: 1, sourceType: "REFERENCE_MARKET_SOURCE", providerType: "DERIV_MARKET_DATA", symbolOverrides: config.derivSymbols },
        ]);
        this.stopListener = this.priorityManager.subscribeToLiveFeed(async (tick) => {
            await this.handleLiveTick(tick);
        });
    }
    start() {
        this.stopping = false;
        this.connectPrimaryStream();
        return () => this.stop();
    }
    stop() {
        this.stopping = true;
        this.stopListener?.();
        this.stopListener = null;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.ws?.close();
        this.ws = null;
        this.diagnostics.DERIV.connection = "DISCONNECTED";
        this.priorityManager.setProviderAvailability("DERIV", false);
    }
    providerHealth() {
        const connection = this.diagnostics.DERIV.connection;
        const receiving = Boolean(this.diagnostics.DERIV.last_tick);
        const configured = Boolean(this.config.derivEnabled);
        const freshnessSeconds = receiving && this.diagnostics.DERIV.last_tick ? Math.max(0, (Date.now() - Date.parse(this.diagnostics.DERIV.last_tick)) / 1000) : null;
        const state = !configured ? "NOT_CONFIGURED" : receiving && freshnessSeconds !== null && freshnessSeconds <= 30 ? "DATA_RECEIVING" : connection === "CONNECTED" ? "CONNECTED" : "WAITING_FOR_DATA";
        return {
            provider: "deriv",
            available: receiving,
            status: !configured ? "NOT_CONFIGURED" : connection === "CONNECTING" ? "DEGRADED" : connection,
            state: !configured ? "NOT_CONFIGURED" : state === "WAITING_FOR_DATA" ? "CONNECTING" : state,
            latencyMs: this.diagnostics.DERIV.latency,
            freshnessSeconds,
            errorRate: connection === "CONNECTED" && this.diagnostics.DERIV.subscription_ack ? 0 : 1,
            qualityScore: receiving && freshnessSeconds !== null && freshnessSeconds <= 30 ? 100 : 0,
            lastChecked: new Date().toISOString(),
        };
    }
    connectPrimaryStream() {
        if (!this.config.derivEnabled) {
            this.diagnostics.DERIV.connection = "DISCONNECTED";
            this.priorityManager.setProviderAvailability("DERIV", false);
            return;
        }
        const wsUrl = new URL(this.config.derivWsUrl || "wss://api.derivws.com/trading/v1/options/ws/public");
        this.diagnostics.DERIV.connection = "CONNECTING";
        this.diagnostics.DERIV.subscribed_symbols = this.discoveredSymbols;
        this.ws = new WebSocket(wsUrl.toString());
        this.ws.on("open", () => {
            this.reconnectDelayMs = 1000;
            this.diagnostics.DERIV.connection = "CONNECTED";
            this.priorityManager.setProviderAvailability("DERIV", true);
            for (const symbol of this.discoveredSymbols) {
                this.ws?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
            }
        });
        this.ws.on("message", (data) => {
            const receivedAt = new Date().toISOString();
            this.diagnostics.DERIV.last_provider_message = receivedAt;
            try {
                const message = JSON.parse(String(data));
                const tickRecord = message?.tick ?? message;
                if (tickRecord && typeof tickRecord === "object" && typeof tickRecord.symbol === "string") {
                    if (message?.subscription?.id || message?.msg_type === "tick")
                        this.diagnostics.DERIV.subscription_ack = true;
                    const rawSymbol = String(tickRecord.symbol);
                    const symbol = displaySymbol(rawSymbol);
                    const price = Number(tickRecord.quote ?? tickRecord.bid ?? tickRecord.ask ?? NaN);
                    if (Number.isFinite(price) && symbol) {
                        const t = { providerId: "DERIV", symbol, price, timestamp: new Date(Number(tickRecord.epoch ?? Date.now() / 1000) * 1000).toISOString(), sourceTimestamp: receivedAt };
                        this.diagnostics.DERIV.last_tick = t.timestamp;
                        this.diagnostics.DERIV.latency = Math.max(0, Date.now() - Date.parse(t.timestamp));
                        this.diagnostics.DERIV.symbols = Array.from(new Set([...this.diagnostics.DERIV.symbols, symbol]));
                        this.priorityManager.broadcastTick(t).catch(() => undefined);
                    }
                }
            }
            catch {
                // ignore malformed payloads; fail closed
            }
        });
        this.ws.on("error", () => {
            this.diagnostics.DERIV.connection = "DISCONNECTED";
        });
        this.ws.on("close", () => {
            this.diagnostics.DERIV.connection = "DISCONNECTED";
            this.priorityManager.setProviderAvailability("DERIV", false);
            this.ws = null;
            if (this.stopping)
                return;
            const delay = this.reconnectDelayMs;
            this.reconnectDelayMs = Math.min(delay * 2, 30000);
            this.diagnostics.DERIV.reconnect_count += 1;
            this.reconnectTimer = setTimeout(() => this.connectPrimaryStream(), delay);
        });
    }
    async handleLiveTick(tick) {
        this.dashboardRelay?.publishTick(tick);
        this.diagnostics.AGENT_ENGINE.active_agents = 1;
        this.diagnostics.MASTER_AGENT.status = "NO_SIGNAL";
        this.diagnostics.MASTER_AGENT.reason = "WAITING_FOR_VALIDATED_DERIV_DATA";
        this.diagnostics.MASTER_AGENT.last_decision = "NO_SIGNAL";
        this.diagnostics.MASTER_AGENT.decision_timestamp = new Date().toISOString();
        this.diagnostics.AGENT_ENGINE.last_consensus = null;
    }
}
