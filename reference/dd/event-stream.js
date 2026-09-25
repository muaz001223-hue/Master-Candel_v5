import { randomUUID } from "node:crypto";
export class MarketEventStream {
    events = [];
    emit(input) {
        const event = {
            ...input,
            eventId: randomUUID(),
            timestamp: input.timestamp ?? new Date().toISOString(),
            systemVersion: input.systemVersion ?? "0.1.0",
        };
        this.events.push(event);
        return event;
    }
    byType(eventType) {
        return this.events.filter((event) => event.eventType === eventType);
    }
    list() {
        return [...this.events];
    }
}
