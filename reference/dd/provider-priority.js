export class ProviderPriorityManager {
    providers;
    subscribers = new Set();
    activeProviderId;
    constructor(providers) {
        this.providers = [...providers].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
        this.activeProviderId = this.resolveActiveProvider()?.id ?? null;
    }
    getProviders() {
        return [...this.providers];
    }
    getActiveProvider() {
        if (!this.activeProviderId)
            return undefined;
        return this.providers.find((provider) => provider.id === this.activeProviderId) ?? this.resolveActiveProvider();
    }
    setProviderAvailability(id, available) {
        const match = this.providers.find((provider) => provider.id === id);
        if (!match)
            return;
        match.available = available;
        if (this.activeProviderId === id && !available) {
            this.activeProviderId = this.resolveActiveProvider()?.id ?? null;
        }
        if (!this.activeProviderId) {
            this.activeProviderId = this.resolveActiveProvider()?.id ?? null;
        }
    }
    subscribeToLiveFeed(handler) {
        this.subscribers.add(handler);
        return () => {
            this.subscribers.delete(handler);
        };
    }
    async broadcastTick(tick) {
        const tasks = [...this.subscribers].map(async (handler) => {
            await Promise.resolve(handler(tick));
        });
        await Promise.all(tasks);
    }
    resolveActiveProvider() {
        const healthy = this.providers
            .filter((provider) => provider.configured && provider.available)
            .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
        return healthy[0] ?? this.providers.find((provider) => provider.configured) ?? this.providers[0];
    }
}
export function createDefaultPriorityProviders() {
    return [
        {
            id: "DERIV",
            name: "Deriv",
            configured: true,
            available: true,
            priority: 1,
            sourceType: "REFERENCE_MARKET_SOURCE",
            providerType: "DERIV_MARKET_DATA",
            symbolOverrides: ["frxEURUSD", "frxGBPUSD", "frxUSDJPY"],
        },
    ];
}
export function buildProviderPriorityManagerFromConfig(config) {
    const providers = [
        {
            id: "DERIV",
            name: "Deriv",
            configured: config.derivEnabled ?? true,
            available: config.derivEnabled ?? true,
            priority: 1,
            sourceType: "REFERENCE_MARKET_SOURCE",
            providerType: "DERIV_MARKET_DATA",
            symbolOverrides: ["frxEURUSD", "frxGBPUSD", "frxUSDJPY"],
        },
    ];
    return new ProviderPriorityManager(providers);
}
