export class AgentPerformanceMemory {
    records = new Map();
    upsert(record) {
        this.records.set(this.key(record.key), record);
    }
    get(key) {
        return this.records.get(this.key(key));
    }
    list(agentId) {
        return [...this.records.values()].filter((record) => !agentId || record.key.agentId === agentId);
    }
    key(key) {
        return `${key.agentId}:${key.instrumentId}:${key.timeframe}:${key.regime}`;
    }
}
