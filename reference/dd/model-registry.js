export class ModelRegistry {
    models = new Map();
    register(model) {
        const key = `${model.modelId}@${model.version}`;
        if (this.models.has(key))
            throw new Error(`Model version already registered: ${key}`);
        this.models.set(key, model);
    }
    activate(modelId, version) {
        const key = `${modelId}@${version}`;
        const model = this.models.get(key);
        if (!model)
            throw new Error(`Unknown model version: ${key}`);
        if (model.status === "DEGRADED" || model.status === "DISABLED" || model.trainingStatus !== "READY")
            throw new Error(`Model is not eligible for activation: ${key}`);
        const activated = { ...model, status: "ACTIVE", trainingStatus: "ACTIVE" };
        this.models.set(key, activated);
        return activated;
    }
    list(status) {
        return [...this.models.values()].filter((model) => !status || model.status === status);
    }
}
