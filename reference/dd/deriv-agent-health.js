import "dotenv/config";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
export function summarizeDerivAgentHealth(agents) {
    const totalAgents = agents.length;
    const activeAndTracking = agents.filter((agent) => agent.connected && agent.subscribed && agent.receivingData && agent.status === "ACTIVE").length;
    const failedOrDisconnected = totalAgents - activeAndTracking;
    return { totalAgents, activeAndTracking, failedOrDisconnected, agents };
}
export function printDerivHealthReport(report) {
    console.log(`Total Agents: ${report.totalAgents} | Active & Tracking: ${report.activeAndTracking} | Failed/Disconnected: ${report.failedOrDisconnected}`);
    const failedAgents = report.agents.filter((agent) => !(agent.connected && agent.subscribed && agent.receivingData));
    if (failedAgents.length === 0) {
        console.log("All agents are connected and receiving live OHLC data.");
        return;
    }
    console.log("Agents requiring attention:");
    for (const agent of failedAgents) {
        console.log(`- ${agent.agentId}: status=${agent.status}, connected=${agent.connected}, subscribed=${agent.subscribed}, receivingData=${agent.receivingData}, lastError=${agent.lastError ?? "none"}`);
    }
}
export function createSimulatedDerivHealthReport(totalAgents = 500) {
    const agents = Array.from({ length: totalAgents }, (_, index) => {
        const agentId = `deriv-agent-${index + 1}`;
        const statusRoll = (index + 1) % 10;
        if (statusRoll === 0) {
            return {
                agentId,
                symbol: "R_10",
                connected: false,
                subscribed: false,
                receivingData: false,
                status: "DISCONNECTED",
                lastError: "connection lost",
            };
        }
        if (statusRoll === 1) {
            return {
                agentId,
                symbol: "R_10",
                connected: true,
                subscribed: false,
                receivingData: false,
                status: "NO_SUBSCRIPTION",
                lastError: "subscribed stream not established",
            };
        }
        if (statusRoll === 2) {
            return {
                agentId,
                symbol: "R_10",
                connected: true,
                subscribed: true,
                receivingData: false,
                status: "NO_DATA",
                lastError: "no candle payload received",
            };
        }
        return {
            agentId,
            symbol: "R_10",
            connected: true,
            subscribed: true,
            receivingData: true,
            status: "ACTIVE",
            lastCandleAt: new Date().toISOString(),
        };
    });
    return summarizeDerivAgentHealth(agents);
}
async function checkSingleAgent(agentId, options) {
    return await new Promise((resolve) => {
        const agentState = {
            agentId,
            symbol: options.symbol,
            connected: false,
            subscribed: false,
            receivingData: false,
            status: "DISCONNECTED",
            lastError: "not started",
        };
        const timeout = setTimeout(() => {
            cleanup();
            resolve({
                ...agentState,
                status: "FAILED",
                connected: false,
                subscribed: false,
                receivingData: false,
                lastError: "timeout waiting for Deriv response",
            });
        }, options.timeoutMs);
        const cleanup = () => {
            clearTimeout(timeout);
            try {
                socket.close();
            }
            catch {
                // no-op
            }
        };
        const socket = new WebSocket(`${options.wsUrl}?app_id=${options.appId}`);
        socket.onopen = () => {
            agentState.connected = true;
            agentState.status = "DISCONNECTED";
            socket.send(JSON.stringify({ authorize: options.token }));
        };
        socket.onmessage = (event) => {
            const payload = JSON.parse(String(event.data));
            if (payload.error) {
                cleanup();
                resolve({
                    ...agentState,
                    connected: false,
                    subscribed: false,
                    receivingData: false,
                    status: "FAILED",
                    lastError: payload.error.message ?? "Deriv returned an error",
                });
                return;
            }
            if (payload.msg_type === "authorize") {
                socket.send(JSON.stringify({
                    ticks_history: options.symbol,
                    style: "candles",
                    granularity: 60,
                    count: 1,
                }));
                return;
            }
            if (payload.msg_type === "history") {
                agentState.subscribed = true;
                const candles = Array.isArray(payload.history?.candles) ? payload.history.candles : [];
                agentState.receivingData = candles.length > 0;
                agentState.status = agentState.receivingData ? "ACTIVE" : "NO_DATA";
                const lastEpoch = candles.at(-1)?.epoch;
                if (typeof lastEpoch === "number") {
                    agentState.lastCandleAt = new Date(lastEpoch * 1000).toISOString();
                }
                else {
                    delete agentState.lastCandleAt;
                }
                cleanup();
                resolve({ ...agentState, connected: true, subscribed: true, receivingData: agentState.receivingData });
                return;
            }
        };
        socket.onerror = () => {
            cleanup();
            resolve({
                ...agentState,
                connected: false,
                subscribed: false,
                receivingData: false,
                status: "FAILED",
                lastError: "WebSocket error",
            });
        };
        socket.onclose = () => {
            if (agentState.status === "DISCONNECTED") {
                resolve({
                    ...agentState,
                    connected: false,
                    subscribed: false,
                    receivingData: false,
                    status: "DISCONNECTED",
                    lastError: "WebSocket closed before stream confirmation",
                });
            }
        };
    });
}
export async function monitorDerivAgents(options = {}) {
    const totalAgents = Math.max(1, options.totalAgents ?? 500);
    const symbol = options.symbol ?? "R_10";
    const token = options.token ?? process.env.DERIV_API_TOKEN ?? "";
    const appId = options.appId ?? process.env.DERIV_APP_ID ?? "1089";
    const wsUrl = options.wsUrl ?? process.env.DERIV_WS_URL ?? "wss://ws.binaryws.com/websockets/v3";
    const timeoutMs = options.timeoutMs ?? 15000;
    const agents = [];
    const validToken = token || "";
    for (let index = 1; index <= totalAgents; index += 1) {
        const agentId = `deriv-agent-${index}`;
        const health = await checkSingleAgent(agentId, {
            symbol,
            token: validToken,
            appId,
            wsUrl,
            timeoutMs,
        });
        agents.push(health);
    }
    const report = summarizeDerivAgentHealth(agents);
    printDerivHealthReport(report);
    return report;
}
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
    const args = new Set(process.argv.slice(2));
    const simulate = args.has("--simulate");
    if (simulate) {
        const count = Number(process.env.DERIV_AGENT_COUNT ?? 500);
        const report = createSimulatedDerivHealthReport(Number.isFinite(count) ? count : 500);
        printDerivHealthReport(report);
    }
    else {
        const totalAgents = Number(process.env.DERIV_AGENT_COUNT ?? 500);
        void monitorDerivAgents({
            totalAgents: Number.isFinite(totalAgents) ? totalAgents : 500,
            symbol: process.env.DERIV_SYMBOLS?.split(",")[0] ?? "R_10",
            token: process.env.DERIV_API_TOKEN ?? "",
            appId: process.env.DERIV_APP_ID ?? "1089",
            wsUrl: process.env.DERIV_WS_URL ?? "wss://ws.binaryws.com/websockets/v3",
            timeoutMs: Number(process.env.DERIV_TIMEOUT_MS ?? 15000),
        });
    }
}
