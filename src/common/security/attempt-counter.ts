type Entry = {
	count: number;
	resetAt: number;
};

// Fixed-window in-memory counter. Har server instance ki apni memory hoti hai;
// multi-instance production ke liye Redis jaisa shared store behtar hai (docs dekhein).
export class AttemptCounter {
	private readonly entries = new Map<string, Entry>();

	constructor(
		readonly max: number,
		readonly windowMs: number,
		private readonly now: () => number = Date.now,
	) {}

	// Counter barhata hai aur batata hai ke limit cross hui ya nahi.
	hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
		const entry = this.current(key, true)!;
		entry.count++;
		return {
			allowed: entry.count <= this.max,
			remaining: Math.max(0, this.max - entry.count),
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)),
		};
	}

	// Counter barhaye baghair check karta hai.
	isBlocked(key: string): { blocked: boolean; retryAfterSeconds: number } {
		const entry = this.current(key, false);
		if (!entry || entry.count < this.max) {
			return { blocked: false, retryAfterSeconds: 0 };
		}
		return {
			blocked: true,
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)),
		};
	}

	reset(key: string): void {
		this.entries.delete(key);
	}

	private current(key: string, create: boolean): Entry | undefined {
		const now = this.now();
		this.removeExpired(now);

		let entry = this.entries.get(key);
		if (entry && entry.resetAt <= now) {
			this.entries.delete(key);
			entry = undefined;
		}
		if (!entry && create) {
			entry = { count: 0, resetAt: now + this.windowMs };
			this.entries.set(key, entry);
		}
		return entry;
	}

	private removeExpired(now: number): void {
		if (this.entries.size < 5000) return;
		for (const [key, entry] of this.entries) {
			if (entry.resetAt <= now) this.entries.delete(key);
		}
	}
}
