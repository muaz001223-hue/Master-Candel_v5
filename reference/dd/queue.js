import { createClient } from "redis";
export class RedisJobStore {
    client;
    queueKey;
    deadLetterKey;
    idempotencyKey;
    constructor(redisUrl, queueName = "market:jobs") {
        this.client = createClient({ url: redisUrl });
        this.queueKey = `${queueName}:ready`;
        this.deadLetterKey = `${queueName}:dead-letter`;
        this.idempotencyKey = `${queueName}:ids`;
    }
    async connect() {
        await this.client.connect();
    }
    async healthcheck() {
        if (!this.client.isOpen)
            return false;
        try {
            return (await this.client.ping()) === "PONG";
        }
        catch {
            return false;
        }
    }
    async reconnect() {
        if (this.client.isOpen)
            return;
        await this.client.connect();
    }
    async enqueue(job) {
        const added = await this.client.sAdd(this.idempotencyKey, job.id);
        if (added === 0)
            return false;
        await this.client.zAdd(this.queueKey, { score: job.availableAt, value: JSON.stringify(job) });
        return true;
    }
    async claim() {
        const values = await this.client.zRangeByScore(this.queueKey, 0, Date.now(), { LIMIT: { offset: 0, count: 1 } });
        const value = values[0];
        if (!value)
            return null;
        const removed = await this.client.zRem(this.queueKey, value);
        if (removed !== 1)
            return null;
        return { ...JSON.parse(value), status: "RUNNING" };
    }
    async complete(id) {
        void id;
    }
    async fail(job, error, deadLetter) {
        const failed = { ...job, status: deadLetter ? "DEAD_LETTER" : "QUEUED", error, availableAt: Date.now() };
        await this.client.zAdd(deadLetter ? this.deadLetterKey : this.queueKey, { score: failed.availableAt, value: JSON.stringify(failed) });
    }
    async close() {
        if (this.client.isOpen)
            await this.client.quit();
    }
}
export class JobWorker {
    store;
    handler;
    maxAttempts;
    concurrency;
    stopping = false;
    constructor(store, handler, maxAttempts = 3, concurrency = 4) {
        this.store = store;
        this.handler = handler;
        this.maxAttempts = maxAttempts;
        this.concurrency = concurrency;
    }
    async drain() {
        const run = async () => {
            while (!this.stopping) {
                const job = await this.store.claim();
                if (!job)
                    return;
                try {
                    await this.handler(job);
                    await this.store.complete(job.id);
                }
                catch (error) {
                    const attempts = job.attempts + 1;
                    const retryJob = { ...job, attempts, availableAt: Date.now() + 2 ** attempts * 100 };
                    await this.store.fail(retryJob, error instanceof Error ? error.message : "unknown", attempts >= this.maxAttempts);
                }
            }
        };
        await Promise.all(Array.from({ length: this.concurrency }, () => run()));
    }
    async runForever(pollIntervalMs = 500) {
        while (!this.stopping) {
            await this.drain();
            if (!this.stopping)
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }
    stop() {
        this.stopping = true;
    }
}
