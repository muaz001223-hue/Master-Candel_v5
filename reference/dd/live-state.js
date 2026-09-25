export class LiveSignalStateMachine {
    state = "NO_DATA";
    snapshot = null;
    get current() { return this.state; }
    get signal() { return this.snapshot; }
    setWaiting() { this.state = "WAITING_FOR_DATA"; }
    setDegraded() { this.state = "DATA_DEGRADED"; }
    setAnalyzing() { this.state = "ANALYZING"; }
    setInsufficientEvidence() { this.state = "INSUFFICIENT_EVIDENCE"; }
    apply(snapshot, now = new Date()) {
        this.snapshot = snapshot;
        const expired = snapshot.expiresAt !== null && new Date(snapshot.expiresAt).getTime() <= now.getTime();
        if (expired) {
            this.state = "STALE";
            return this.state;
        }
        this.state = snapshot.signal === "CALL" ? "CALL" : snapshot.signal === "PUT" ? "PUT" : "NO_SIGNAL";
        return this.state;
    }
    expire(now = new Date()) {
        if (!this.snapshot?.expiresAt || new Date(this.snapshot.expiresAt).getTime() > now.getTime())
            return false;
        this.state = "STALE";
        return true;
    }
}
