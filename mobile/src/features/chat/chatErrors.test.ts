import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
	default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { ApiError } from "@/lib/api";
import { classifyChatError, parseErrorCodePrefix, recoveryExhaustedError } from "./chatErrors";

describe("parseErrorCodePrefix", () => {
	it("parses a [code] prefix and strips it from the message", () => {
		expect(parseErrorCodePrefix("[rate_limited] Slow down.")).toEqual({
			code: "rate_limited",
			rest: "Slow down.",
		});
	});

	it("ignores bracket tags that are not server codes", () => {
		expect(parseErrorCodePrefix("[note] see above")).toBeNull();
	});

	it("returns null without a prefix", () => {
		expect(parseErrorCodePrefix("plain message")).toBeNull();
	});
});

describe("classifyChatError", () => {
	it("uses the code from a JSON error body (AI SDK transport raw body)", () => {
		const error = new Error('{"error":"That reference is not in the Bible.","code":"invalid_input"}');
		const classified = classifyChatError(error);
		expect(classified.code).toBe("invalid_input");
		expect(classified.message).toBe("That reference is not in the Bible.");
		expect(classified.retryable).toBe(false);
	});

	it("uses the code from a mid-stream [code] chunk", () => {
		const classified = classifyChatError("[provider_error] The model overloaded.");
		expect(classified.code).toBe("provider_error");
		expect(classified.message).toBe("The model overloaded.");
		expect(classified.retryable).toBe(true);
	});

	it("maps a 401 ApiError to unauthorized", () => {
		const classified = classifyChatError(new ApiError("Request failed: 401", { status: 401 }));
		expect(classified.code).toBe("unauthorized");
		expect(classified.retryable).toBe(false);
	});

	it("maps a 429 ApiError to rate_limited and keeps the server message", () => {
		const classified = classifyChatError(new ApiError("Too many questions today.", { status: 429 }));
		expect(classified.code).toBe("rate_limited");
		expect(classified.message).toBe("Too many questions today.");
		expect(classified.retryable).toBe(true);
	});

	it("maps a 500 ApiError to internal", () => {
		const classified = classifyChatError(new ApiError("Request failed: 500", { status: 500 }));
		expect(classified.code).toBe("internal");
		expect(classified.retryable).toBe(true);
	});

	it("maps a network ApiError to offline", () => {
		const classified = classifyChatError(
			new ApiError("You appear to be offline. Reconnect and try again.", { isNetworkError: true })
		);
		expect(classified.code).toBe("offline");
		expect(classified.message).toBe("You appear to be offline. Reconnect and try again.");
		expect(classified.retryable).toBe(true);
	});

	it("maps a timeout ApiError to timeout", () => {
		const classified = classifyChatError(
			new ApiError("The request timed out. Check your connection and try again.", { isTimeout: true })
		);
		expect(classified.code).toBe("timeout");
		expect(classified.retryable).toBe(true);
	});

	it("maps a raw TypeError network failure to offline", () => {
		const classified = classifyChatError(new TypeError("Network request failed"));
		expect(classified.code).toBe("offline");
	});

	it("falls back to internal with the bare message from an old server", () => {
		const classified = classifyChatError("Something unexpected happened.");
		expect(classified.code).toBe("internal");
		expect(classified.message).toBe("Something unexpected happened.");
	});

	it("keeps an old server's bare JSON error message without a code", () => {
		const classified = classifyChatError(
			new ApiError('{"error":"We could not answer that."}', { status: 500 })
		);
		expect(classified.code).toBe("internal");
		expect(classified.message).toBe("We could not answer that.");
	});

	it("never shows raw JSON to the user", () => {
		const classified = classifyChatError(new Error('{"unexpected":true,"trace":"abc"}'));
		expect(classified.code).toBe("internal");
		expect(classified.message).not.toContain("{");
	});

	it("prefers the override message when given", () => {
		const classified = classifyChatError(new ApiError("boom", { status: 500 }), {
			message: "Couldn't start the conversation. Check your connection and try again.",
		});
		expect(classified.message).toBe("Couldn't start the conversation. Check your connection and try again.");
	});

	it("classifies unknown input as internal", () => {
		expect(classifyChatError(undefined).code).toBe("internal");
		expect(classifyChatError(null).code).toBe("internal");
	});
});

describe("recoveryExhaustedError", () => {
	it("keeps the existing recovery copy and stays retryable", () => {
		const classified = recoveryExhaustedError();
		expect(classified.message).toBe("We couldn't retrieve that answer. Retry to ask again.");
		expect(classified.retryable).toBe(true);
	});
});
