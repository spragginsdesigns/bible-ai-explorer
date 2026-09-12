import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	data: new Map<string, string>(),
	handlers: new Map<string, (state: string) => void>(),
	cleanups: [] as (() => void)[],
	userId: "alice",
	getToken: vi.fn(async () => "alice-token"),
	apiJson: vi.fn(async (_token: () => Promise<string | null>) => ({
		recorded: true,
	})),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: async (k: string) => mocks.data.get(k) ?? null,
		setItem: async (k: string, v: string) => {
			mocks.data.set(k, v);
		},
		removeItem: async (k: string) => {
			mocks.data.delete(k);
		},
		getAllKeys: async () => [...mocks.data.keys()],
	},
}));
vi.mock("expo-crypto", () => ({
	randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
}));
vi.mock("react-native", () => ({
	AppState: {
		currentState: "active",
		addEventListener: (name: string, fn: (state: string) => void) => {
			mocks.handlers.set(name, fn);
			return { remove: () => mocks.handlers.delete(name) };
		},
	},
}));
vi.mock("react", () => ({
	useEffect: (effect: () => undefined | (() => void)) => {
		const cleanup = effect();
		if (cleanup) mocks.cleanups.push(cleanup);
	},
	useSyncExternalStore: (_: unknown, getSnapshot: () => unknown) =>
		getSnapshot(),
}));
vi.mock("@clerk/expo", () => ({
	useAuth: () => ({ userId: mocks.userId, getToken: mocks.getToken }),
}));
vi.mock("@/lib/api", () => ({
	apiJson: (...args: unknown[]) =>
		mocks.apiJson(...(args as [() => Promise<string | null>])),
	subscribeApiAvailability: () => () => {},
}));
const input = {
	book: 43,
	chapter: 1,
	translation: "KJV",
	verses: [1],
	verseCount: 51,
	now: Date.parse("2026-09-12T08:00:00Z"),
	timezone: "UTC",
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	mocks.data.clear();
	mocks.handlers.clear();
	mocks.cleanups = [];
	mocks.userId = "alice";
	mocks.apiJson.mockReset().mockResolvedValue({ recorded: true });
	mocks.getToken.mockReset().mockResolvedValue("alice-token");
});
afterEach(() => {
	for (const c of mocks.cleanups) c();
	vi.useRealTimers();
});
async function start() {
	const store = await import("./readingLogStore");
	store.useReadingLogSync();
	await vi.advanceTimersByTimeAsync(1);
	return store;
}
describe("foreground reading sync scheduler", () => {
	it("persists immediately, batches radio work, and reports pending until actual ack", async () => {
		const store = await start();
		await store.recordVisibleReading("alice", input);
		expect(mocks.data.size).toBe(2);
		expect(mocks.apiJson).not.toHaveBeenCalled();
		expect(store.useReadingLogStatus().pending).toBe(1);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(mocks.apiJson).toHaveBeenCalledTimes(1);
		expect(store.useReadingLogStatus().pending).toBe(0);
		await vi.advanceTimersByTimeAsync(24 * 3600_000);
		expect(mocks.apiJson).toHaveBeenCalledTimes(1);
	});
	it("does no background retries; resumes pending work when foregrounded", async () => {
		const store = await start();
		await store.recordVisibleReading("alice", input);
		mocks.handlers.get("change")!("background");
		await vi.advanceTimersByTimeAsync(12 * 3600_000);
		expect(mocks.apiJson).not.toHaveBeenCalled();
		mocks.handlers.get("change")!("active");
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.apiJson).toHaveBeenCalledTimes(1);
	});
	it("bounds retry attempts and restarts only on explicit retry or resume", async () => {
		const store = await start();
		mocks.apiJson.mockRejectedValue(new Error("offline"));
		await store.recordVisibleReading("alice", input);
		await vi.advanceTimersByTimeAsync(24 * 3600_000);
		expect(mocks.apiJson).toHaveBeenCalledTimes(6);
		expect(store.useReadingLogStatus().pending).toBe(1);
		store.retryReadingSync();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.apiJson).toHaveBeenCalledTimes(7);
	});
	it("allows only one in-flight request and sends new revision afterward", async () => {
		const store = await start();
		let finish!: (value: { recorded: boolean }) => void;
		mocks.apiJson.mockImplementationOnce(
			() => new Promise((r) => (finish = r)),
		);
		await store.recordVisibleReading("alice", input);
		await vi.advanceTimersByTimeAsync(15_000);
		await store.recordVisibleReading("alice", { ...input, verses: [2] });
		store.retryReadingSync();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.apiJson).toHaveBeenCalledTimes(1);
		finish({ recorded: true });
		await vi.advanceTimersByTimeAsync(15_001);
		expect(mocks.apiJson).toHaveBeenCalledTimes(2);
		expect(store.useReadingLogStatus().pending).toBe(0);
	});
	it("does not queue a reading captured under a departed account", async () => {
		const store = await start();
		await store.recordVisibleReading("bob", input);
		expect(mocks.data.size).toBe(0);
		expect(store.useReadingLogStatus().pending).toBe(0);
	});
});

it("expires a stalled token, permits recovery, and never sends after that old token resolves", async () => {
	const store = await start();
	let release!: (token: string) => void;
	mocks.getToken.mockImplementationOnce(
		() =>
			new Promise<string>((resolve) => {
				release = resolve;
			}),
	);
	const network = vi.fn();
	mocks.apiJson.mockImplementation(async (getToken) => {
		const token = await getToken();
		network(token);
		return { recorded: true };
	});
	await store.recordVisibleReading("alice", input);
	await vi.advanceTimersByTimeAsync(15_000);
	expect(network).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(15_001);
	expect(store.useReadingLogStatus().pending).toBe(1);
	store.retryReadingSync();
	await vi.advanceTimersByTimeAsync(1);
	expect(network).toHaveBeenCalledTimes(1);
	expect(store.useReadingLogStatus().pending).toBe(0);
	release("expired-token");
	await vi.advanceTimersByTimeAsync(1);
	expect(network).toHaveBeenCalledTimes(1);
});

it("expires a stalled response body and acknowledges a later idempotent retry", async () => {
	const store = await start();
	let finish!: (value: { recorded: boolean }) => void;
	mocks.apiJson.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await store.recordVisibleReading("alice", input);
	await vi.advanceTimersByTimeAsync(30_001);
	expect(store.useReadingLogStatus().pending).toBe(1);
	store.retryReadingSync();
	await vi.advanceTimersByTimeAsync(1);
	expect(mocks.apiJson).toHaveBeenCalledTimes(2);
	expect(store.useReadingLogStatus().pending).toBe(0);
	finish({ recorded: true });
	await vi.advanceTimersByTimeAsync(1);
	expect(store.useReadingLogStatus().pending).toBe(0);
});
