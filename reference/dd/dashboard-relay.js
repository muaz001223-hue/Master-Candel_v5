import { WebSocketServer } from "ws";
export class DashboardRelay {
    port;
    clients = new Set();
    candles = new Map();
    server = null;
    constructor(port = 8080) {
        this.port = port;
    }
    start() {
        if (this.server)
            return;
        this.server = new WebSocketServer({ host: "127.0.0.1", port: this.port });
        this.server.on("connection", (client) => {
            this.clients.add(client);
            for (const candle of this.candles.values()) {
                if (client.readyState === 1)
                    client.send(JSON.stringify(candle));
            }
            client.once("close", () => this.clients.delete(client));
            client.once("error", () => this.clients.delete(client));
        });
        this.server.on("listening", () => console.log(`[DASHBOARD-RELAY] listening ws://127.0.0.1:${this.port}`));
        this.server.on("error", (error) => console.error("[DASHBOARD-RELAY] error", error));
    }
    latest(symbol) {
        for (const candle of this.candles.values()) {
            if (candle.symbol === symbol)
                return candle;
        }
        return null;
    }
    snapshot() {
        return [...this.candles.values()];
    }
    publishTick(tick) {
        if (!Number.isFinite(tick.price))
            return;
        const parsed = Date.parse(tick.timestamp);
        if (!Number.isFinite(parsed))
            return;
        const providerId = tick.providerId || "DERIV";
        const bucket = new Date(Math.floor(parsed / 60_000) * 60_000).toISOString();
        const key = `${providerId}:${tick.symbol}`;
        const previous = this.candles.get(key);
        const candle = previous && previous.timestamp === bucket
            ? { ...previous, high: Math.max(previous.high, tick.price), low: Math.min(previous.low, tick.price), close: tick.price }
            : { symbol: tick.symbol, timeframe: "1m", timestamp: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: null, source: providerId, provider: providerId };
        this.candles.set(key, candle);
        this.broadcast(candle);
    }
    stop() {
        for (const client of this.clients)
            client.close();
        this.clients.clear();
        this.server?.close();
        this.server = null;
    }
    broadcast(payload) {
        const serialized = JSON.stringify(payload);
        console.log(`[RELAY] candle event delivered symbol=${payload.symbol} timeframe=${payload.timeframe} timestamp=${payload.timestamp} close=${payload.close}`);
        for (const client of this.clients) {
            if (client.readyState === 1)
                client.send(serialized);
        }
    }
}
