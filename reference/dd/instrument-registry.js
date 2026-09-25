import { randomUUID } from "node:crypto";
export class InstrumentRegistry {
    instruments = new Map();
    discover(items, now = new Date().toISOString()) {
        return items.map((item) => {
            const existing = [...this.instruments.values()].find((instrument) => instrument.provider === item.provider && instrument.providerSymbol === item.providerSymbol);
            const instrument = existing
                ? { ...existing, ...item, lastSeen: now, availability: true, status: "ACTIVE", timezone: item.timezone ?? existing.timezone, metadata: item.metadata ?? existing.metadata }
                : {
                    instrumentId: randomUUID(), ...item, status: "ACTIVE", availability: true,
                    firstSeen: now, lastSeen: now, timezone: item.timezone ?? "UTC", metadata: item.metadata ?? {},
                };
            this.instruments.set(instrument.instrumentId, instrument);
            return instrument;
        });
    }
    markUnavailable(provider, now = new Date().toISOString()) {
        for (const [id, instrument] of this.instruments) {
            if (instrument.provider === provider)
                this.instruments.set(id, { ...instrument, availability: false, status: "UNAVAILABLE", lastSeen: now });
        }
    }
    list(status) {
        return [...this.instruments.values()].filter((instrument) => !status || instrument.status === status);
    }
}
