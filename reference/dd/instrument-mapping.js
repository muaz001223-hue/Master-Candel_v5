export class InstrumentMappingRegistry {
    mappings = new Map();
    register(mapping) {
        const key = `${mapping.providerId}:${mapping.providerSymbol}`;
        if (this.mappings.has(key))
            throw new Error(`Instrument mapping already exists: ${key}`);
        this.mappings.set(key, mapping);
    }
    get(providerId, providerSymbol) { return this.mappings.get(`${providerId}:${providerSymbol}`); }
    list(providerId) { return [...this.mappings.values()].filter((mapping) => !providerId || mapping.providerId === providerId); }
}
