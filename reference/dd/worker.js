import { loadConfig } from "./config.js";
import { RedisJobStore, JobWorker } from "./jobs/queue.js";
const config = loadConfig();
if (!config.redisUrl)
    throw new Error("REDIS_URL is required for the worker");
const store = new RedisJobStore(config.redisUrl, "market:jobs");
await store.connect();
const worker = new JobWorker(store, async (job) => {
    if (job.type === "market-observation")
        return;
    if (job.type === "backtest" || job.type === "monte-carlo" || job.type === "stress-test")
        return;
    throw new Error(`unsupported job type: ${job.type}`);
}, config.agentMaxRetries + 1, Math.min(config.maxAgentConcurrency, 10));
const shutdown = async () => {
    worker.stop();
    await store.close();
};
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
console.log(JSON.stringify({ service: "worker", status: "running", concurrency: Math.min(config.maxAgentConcurrency, 10) }));
await worker.runForever();
