import { loadConfig } from "../config.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";
import { createSpecializedAgents } from "../agents/specialized.js";
import { LiveProviderBridge } from "./live-provider-bridge.js";
const config = loadConfig();
const registry = new AgentRegistry();
for (const agent of createSpecializedAgents())
    registry.register(agent);
const orchestrator = new AgentOrchestrator(registry, { maxConcurrency: Math.min(config.maxAgentConcurrency || 10, 500) });
const bridge = new LiveProviderBridge(config, registry, orchestrator);
const stop = bridge.start();
const timeout = setTimeout(() => {
    console.log("LIVE_RUNTIME_DIAGNOSTICS");
    console.log(JSON.stringify(bridge.diagnostics, null, 2));
    stop();
    process.exit(0);
}, 20000);
process.on("SIGINT", () => {
    clearTimeout(timeout);
    stop();
    process.exit(0);
});
