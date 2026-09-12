import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	network: vi.fn(async () => ({ entries: [] })),
}));
vi.mock("@/lib/api", () => ({
	ApiError: class extends Error {
		isTimeout?: boolean;
		constructor(message: string, options: { isTimeout?: boolean }) {
			super(message);
			this.isTimeout = options.isTimeout;
		}
	},
	apiJson: async (getToken: () => Promise<string | null>) => {
		await getToken();
		return mocks.network();
	},
}));
import { fetchReadingHistory } from "./readingLogApi";
beforeEach(() => {
	vi.useFakeTimers();
	mocks.network.mockReset().mockResolvedValue({ entries: [] });
});
afterEach(() => vi.useRealTimers());
describe("reading history request deadline", () => {
	it("releases the UI request after a stalled Clerk token and forbids late network sends", async () => {
		let resolveToken!: (token: string) => void;
		const token = new Promise<string>((resolve) => (resolveToken = resolve));
		const request = fetchReadingHistory(
			() => token,
			"/api/reading-log",
			() => true
		);
		const result = expect(request).rejects.toMatchObject({
			isTimeout: true,
			message:
				"Reading history could not be loaded. Check your connection and try again.",
		});
		await vi.advanceTimersByTimeAsync(15_000);
		await result;
		resolveToken("expired-token");
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.network).not.toHaveBeenCalled();
	});
	it("forbids a token from a departed account from issuing the request", async () => {
		let active = true;
		let resolveToken!: (token: string) => void;
		const token = new Promise<string>((resolve) => (resolveToken = resolve));
		const request = fetchReadingHistory(
			() => token,
			"/api/reading-log",
			() => active
		);
		const result = expect(request).rejects.toThrow("expired");
		await vi.advanceTimersByTimeAsync(1);
		active = false;
		resolveToken("old-owner");
		await result;
		expect(mocks.network).not.toHaveBeenCalled();
	});
	it("bounds a stalled response body and permits a fresh successful retry", async () => {
		mocks.network.mockImplementationOnce(() => new Promise(() => {}));
		const request = fetchReadingHistory(
			async () => "token",
			"/api/reading-log",
			() => true
		);
		const result = expect(request).rejects.toMatchObject({ isTimeout: true });
		await vi.advanceTimersByTimeAsync(15_000);
		await result;
		await expect(
			fetchReadingHistory(
				async () => "token",
				"/api/reading-log",
				() => true
			)
		).resolves.toEqual({ entries: [] });
	});
});
