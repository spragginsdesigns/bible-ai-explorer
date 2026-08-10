import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("expo-constants", () => ({
	default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { fetch as expoFetch } from "expo/fetch";
import { ApiError, apiJson, isOfflineMessage, makeAuthedFetch, setAuthFailureHandler, type GetToken } from "./api";

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const respondWith = (spy: MockInstance<typeof fetch>, ...responses: Response[]) => {
	const queue = [...responses];
	spy.mockImplementation(async () => {
		const next = queue.shift() ?? responses[responses.length - 1];
		return next.clone();
	});
};

describe("makeAuthedFetch", () => {
	beforeEach(() => vi.clearAllMocks());

	it("injects the bearer token", async () => {
		vi.mocked(expoFetch).mockResolvedValue(jsonResponse(200, {}) as never);
		const getToken: GetToken = async () => "tok-1";
		await makeAuthedFetch(getToken)("https://api.test/x");
		const [, init] = vi.mocked(expoFetch).mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
		expect(init.headers.authorization).toBe("Bearer tok-1");
	});

	it("retries once with a fresh token on 401", async () => {
		vi.mocked(expoFetch)
			.mockResolvedValueOnce(jsonResponse(401, {}) as never)
			.mockResolvedValueOnce(jsonResponse(200, {}) as never);
		const calls: Array<{ fresh?: boolean } | undefined> = [];
		const getToken: GetToken = async (opts) => {
			calls.push(opts);
			return "tok-2";
		};
		const res = await makeAuthedFetch(getToken)("https://api.test/x");
		expect(res.status).toBe(200);
		expect(calls).toEqual([undefined, { fresh: true }]);
		expect(vi.mocked(expoFetch)).toHaveBeenCalledTimes(2);
	});

	it("does not retry non-401 failures", async () => {
		vi.mocked(expoFetch).mockResolvedValue(jsonResponse(500, {}) as never);
		const getToken: GetToken = async () => "tok";
		const res = await makeAuthedFetch(getToken)("https://api.test/x");
		expect(res.status).toBe(500);
		expect(vi.mocked(expoFetch)).toHaveBeenCalledTimes(1);
	});

	it("aborts a stalled connection after the stream timeout", async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(expoFetch).mockImplementation(
				((_url: string, init?: { signal?: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () =>
							reject(new Error("The operation was aborted."))
						);
					})) as never
			);
			const getToken: GetToken = async () => "tok";
			const promise = makeAuthedFetch(getToken)("https://api.test/x");
			const assertion = expect(promise).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(45_000);
			const error = await promise.catch((e) => e);
			expect(error).toBeInstanceOf(ApiError);
			expect(error.isTimeout).toBe(true);
			expect(isOfflineMessage(error)).toBe(true);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the timeout once response headers arrive", async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(expoFetch).mockResolvedValue(jsonResponse(200, {}) as never);
			const getToken: GetToken = async () => "tok";
			await makeAuthedFetch(getToken)("https://api.test/x");
			// No abort should fire later: a resolved fetch must not be killed.
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("apiJson", () => {
	let fetchSpy: MockInstance<typeof fetch>;

	// The spy is created per test: a describe-scoped spy + mockReset leaks a
	// phantom fetch call into undici under Node's global fetch.
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("returns parsed JSON", async () => {
		respondWith(fetchSpy, jsonResponse(200, { ok: true }));
		await expect(apiJson(async () => "tok", "/api/x")).resolves.toEqual({ ok: true });
	});

	it("surfaces the server's error message", async () => {
		respondWith(fetchSpy, jsonResponse(400, { error: "Bad reference" }));
		await expect(apiJson(async () => "tok", "/api/x")).rejects.toThrow("Bad reference");
	});

	it("retries with a fresh token on 401", async () => {
		respondWith(fetchSpy, jsonResponse(401, {}), jsonResponse(200, { ok: true }));
		const calls: Array<{ fresh?: boolean } | undefined> = [];
		const getToken: GetToken = async (opts) => {
			calls.push(opts);
			return "tok";
		};
		await expect(apiJson(getToken, "/api/x")).resolves.toEqual({ ok: true });
		expect(calls).toEqual([undefined, { fresh: true }]);
	});

	it("maps network failures to an offline ApiError", async () => {
		fetchSpy.mockRejectedValue(new TypeError("Network request failed"));
		const error = await apiJson(async () => "tok", "/api/x").catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(isOfflineMessage(error)).toBe(true);
	});
});

describe("auth failure reporting", () => {
	let fetchSpy: MockInstance<typeof fetch>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
		setAuthFailureHandler(null);
	});

	it("fires the handler when the fresh-token retry still 401s", async () => {
		respondWith(fetchSpy, jsonResponse(401, {}));
		const handler = vi.fn();
		setAuthFailureHandler(handler);
		await expect(apiJson(async () => "tok", "/api/x")).rejects.toThrow();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("does not fire when the fresh-token retry recovers", async () => {
		respondWith(fetchSpy, jsonResponse(401, {}), jsonResponse(200, { ok: true }));
		const handler = vi.fn();
		setAuthFailureHandler(handler);
		await expect(apiJson(async () => "tok", "/api/x")).resolves.toEqual({ ok: true });
		expect(handler).not.toHaveBeenCalled();
	});
});
