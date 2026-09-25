import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(nodeScrypt);
const permissions = { USER: ["analysis:read"], RESEARCHER: ["analysis:read", "simulation:write"], ADMIN: ["analysis:read", "simulation:write", "models:manage", "audit:read"] };
export async function hashPassword(password) {
    if (password.length < 12)
        throw new Error("password must be at least 12 characters");
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, 64));
    return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
    const [salt, expectedHex] = encoded.split(":");
    if (!salt || !expectedHex)
        return false;
    const actual = (await scrypt(password, salt, 64));
    const expected = Buffer.from(expectedHex, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export class AuthService {
    sessions = new Map();
    async createSession(user, password, ttlMs = 3_600_000) {
        if (!await verifyPassword(password, user.passwordHash))
            throw new Error("invalid credentials");
        const token = randomBytes(32).toString("base64url");
        this.sessions.set(createHash("sha256").update(token).digest("hex"), { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: Date.now() + ttlMs });
        return token;
    }
    authorize(token, permission, users) {
        const session = this.sessions.get(createHash("sha256").update(token).digest("hex"));
        if (!session || session.expiresAt <= Date.now())
            throw new Error("unauthorized");
        const user = users.get(session.userId);
        if (!user || !permissions[user.role].includes(permission))
            throw new Error("forbidden");
        return user;
    }
    revoke(token) { this.sessions.delete(createHash("sha256").update(token).digest("hex")); }
}
export class RateLimiter {
    limit;
    windowMs;
    hits = new Map();
    constructor(limit, windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
    }
    allow(key, now = Date.now()) {
        const current = this.hits.get(key);
        if (!current || current.resetAt <= now) {
            this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
            return true;
        }
        if (current.count >= this.limit)
            return false;
        current.count += 1;
        return true;
    }
}
