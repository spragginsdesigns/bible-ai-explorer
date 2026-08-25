import { LRUCache } from "lru-cache";

/**
 * Per-instance sliding-window rate limiter.
 *
 * Caveat: on serverless each warm instance keeps its own buckets, so this
 * bounds bursts per instance rather than enforcing a global per-user quota.
 * Good enough to blunt accidents and casual abuse without standing up Redis.
 */

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the current window resets; 0 when the request is allowed. */
	retryAfterSeconds: number;
}

export interface RateLimiter {
	check(key: string, now?: number): RateLimitResult;
}

export function createRateLimiter(options: {
	limit: number;
	windowMs: number;
	maxKeys?: number;
}): RateLimiter {
	const buckets = new LRUCache<string, { count: number; resetAt: number }>({
		max: options.maxKeys ?? 5000,
		ttl: options.windowMs,
	});

	return {
		check(key, now = Date.now()) {
			const bucket = buckets.get(key);
			if (!bucket || now >= bucket.resetAt) {
				buckets.set(key, { count: 1, resetAt: now + options.windowMs });
				return { allowed: true, retryAfterSeconds: 0 };
			}
			bucket.count += 1;
			return {
				allowed: bucket.count <= options.limit,
				retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
			};
		},
	};
}

// 20 questions per 5 minutes per user - generous for real reading, tight
// enough to stop a script hammering the AI providers on someone's key.
export const ASK_QUESTION_RATE_LIMIT = 20;
export const ASK_QUESTION_RATE_WINDOW_MS = 5 * 60 * 1000;

export const askQuestionRateLimiter = createRateLimiter({
	limit: ASK_QUESTION_RATE_LIMIT,
	windowMs: ASK_QUESTION_RATE_WINDOW_MS,
});

/** Key by user id; fall back to the forwarded IP when there isn't one. */
export function rateLimitKey(req: Request, userId: string | null): string {
	if (userId) return `user:${userId}`;
	const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return `ip:${forwarded || "unknown"}`;
}
