import assert from "node:assert/strict";
import test from "node:test";

import {
	classifyChatError,
	extractCodePrefix,
} from "../src/lib/chat/chatErrors.ts";
import { createRateLimiter, rateLimitKey } from "../src/lib/rateLimit.ts";

// Contract: JSON body code > [code] prefix > HTTP status > network/timeout
// detection > generic internal fallback.

test("classifies by the code in a JSON error body", () => {
	const result = classifyChatError({
		status: 429,
		bodyText: JSON.stringify({ error: "Slow down.", code: "rate_limited" }),
	});
	assert.equal(result.code, "rate_limited");
	assert.equal(result.message, "Slow down.");
	assert.equal(result.retryable, true);
});

test("parses the raw-JSON-body message the AI SDK transport throws", () => {
	const result = classifyChatError({
		message:
			'{"error":"Add your OpenAI API key in Settings → AI Providers to use this model.","code":"provider_key_missing"}',
	});
	assert.equal(result.code, "provider_key_missing");
	assert.equal(
		result.message,
		"Add your OpenAI API key in Settings → AI Providers to use this model."
	);
	assert.equal(result.retryable, false);
});

test("classifies by a [code] prefix from a mid-stream error chunk", () => {
	const result = classifyChatError({
		message: "[provider_error] The AI provider could not complete this request.",
	});
	assert.equal(result.code, "provider_error");
	assert.equal(result.message, "The AI provider could not complete this request.");
	assert.equal(result.retryable, true);
});

test("extractCodePrefix ignores unknown codes and missing prefixes", () => {
	assert.deepEqual(extractCodePrefix("[bogus] hi"), { code: null, message: "[bogus] hi" });
	assert.deepEqual(extractCodePrefix("plain message"), { code: null, message: "plain message" });
	assert.deepEqual(extractCodePrefix("[internal] boom"), { code: "internal", message: "boom" });
});

test("classifies by HTTP status when no code is available", () => {
	assert.equal(classifyChatError({ status: 401 }).code, "unauthorized");
	assert.equal(classifyChatError({ status: 429 }).code, "rate_limited");
	assert.equal(classifyChatError({ status: 404 }).code, "conversation_not_found");
	assert.equal(classifyChatError({ status: 400 }).code, "invalid_input");
	assert.equal(classifyChatError({ status: 500 }).code, "internal");
	assert.equal(classifyChatError({ status: 401 }).retryable, false);
});

test("detects offline from the browser's TypeError message", () => {
	const result = classifyChatError({ message: "Failed to fetch" });
	assert.equal(result.code, "internal");
	assert.equal(result.title, "You're offline");
	assert.equal(result.retryable, true);
});

test("does not mistake the SDK's empty-body fallback for a dead connection", () => {
	const result = classifyChatError({ message: "Failed to fetch the chat response." });
	assert.equal(result.title, "Something went wrong");
});

test("detects timeouts", () => {
	const result = classifyChatError({ message: "The request timed out" });
	assert.equal(result.title, "Request timed out");
	assert.equal(result.retryable, true);
});

test("falls back to a generic internal error", () => {
	const result = classifyChatError({ message: "weird unparseable failure" });
	assert.equal(result.code, "internal");
	assert.equal(result.title, "Something went wrong");
	assert.equal(result.retryable, true);
});

test("rate limiter allows up to the limit, then blocks with a retry-after", () => {
	const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
	assert.deepEqual(limiter.check("u1", 0), { allowed: true, retryAfterSeconds: 0 });
	assert.equal(limiter.check("u1", 100).allowed, true);
	assert.equal(limiter.check("u1", 200).allowed, true);

	const blocked = limiter.check("u1", 300);
	assert.equal(blocked.allowed, false);
	assert.equal(blocked.retryAfterSeconds, 60);

	// Other keys are independent.
	assert.equal(limiter.check("u2", 300).allowed, true);

	// The window resets after windowMs.
	assert.equal(limiter.check("u1", 61_000).allowed, true);
});

test("rateLimitKey prefers the user id and falls back to the forwarded IP", () => {
	const req = new Request("https://example.com", {
		headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
	});
	assert.equal(rateLimitKey(req, "user_123"), "user:user_123");
	assert.equal(rateLimitKey(req, null), "ip:203.0.113.7");
	assert.equal(rateLimitKey(new Request("https://example.com"), null), "ip:unknown");
});
