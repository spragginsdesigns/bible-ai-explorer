import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
		setItem: vi.fn(async (key: string, value: string) => {
			storage.set(key, value);
		}),
		removeItem: vi.fn(async (key: string) => {
			storage.delete(key);
		}),
	},
}));

const fetchProviders = vi.fn();
const fetchChurch = vi.fn();
const fetchMemories = vi.fn();

vi.mock("./aiApi", () => ({ fetchProviders: (...args: unknown[]) => fetchProviders(...args) }));
vi.mock("@/features/church/api", () => ({
	fetchChurch: (...args: unknown[]) => fetchChurch(...args),
}));
vi.mock("@/features/memories/api", () => ({
	fetchMemories: (...args: unknown[]) => fetchMemories(...args),
}));

import {
	REFRESH_TIMEOUT_MS,
	clearSettingsData,
	getSettingsData,
	hydrateSettingsData,
	noteChurch,
	noteMemoryCount,
	noteMemoryEnabled,
	prefetchSettingsData,
	refreshMemories,
	refreshProviders,
} from "./settingsData";

const STORAGE_KEY = "sureword.settings-data.v1";
const getToken = async () => "token";

const PROVIDERS = {
	serverCredentials: false,
	providers: [
		{
			id: "openai",
			label: "OpenAI",
			keyUrl: "https://example.com",
			connected: true,
			last4: "abcd",
			validatedAt: null,
		},
	],
};

const CHURCH = {
	status: "ok" as const,
	church: {
		placeId: "p1",
		name: "First Church",
		address: "1 Main St",
		phone: null,
		website: null,
		mapsUrl: null,
		photoUrl: null,
		mission: null,
		about: null,
		missionSource: null,
		updatedAt: "2026-09-11T00:00:00.000Z",
	},
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Let every queued microtask (mock resolutions, .then chains) settle. */
async function flush() {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(async () => {
	storage.clear();
	fetchProviders.mockReset();
	fetchChurch.mockReset();
	fetchMemories.mockReset();
	// Each test starts from an empty, un-hydrated store; clear() marks it
	// hydrated, so seed the persisted blob afterwards where a test needs it.
	await clearSettingsData();
});

describe("settingsData", () => {
	it("fills only the sections that are still empty when the persisted cache is read", async () => {
		// clear() replaced the hydrate promise, so re-import semantics are
		// exercised through a fresh module instance instead.
		vi.resetModules();
		storage.set(
			STORAGE_KEY,
			JSON.stringify({ providers: PROVIDERS, church: CHURCH, memories: { count: 3 } })
		);
		const fresh = await import("./settingsData");
		// A prefetch that lands while the disk read is still in flight must not
		// be overwritten by it.
		const hydrate = fresh.hydrateSettingsData();
		fresh.noteMemoryCount(7);
		await hydrate;
		const snap = fresh.getSettingsData();
		expect(snap.hydrated).toBe(true);
		expect(snap.providers.data).toEqual(PROVIDERS);
		expect(snap.church.data).toEqual(CHURCH);
		expect(snap.memories.data).toEqual({ count: 7 });
	});

	it("persists a successful refresh and clears the failed flag", async () => {
		fetchProviders.mockResolvedValueOnce(PROVIDERS);
		await refreshProviders(getToken);
		expect(getSettingsData().providers).toEqual({
			data: PROVIDERS,
			loading: false,
			failed: false,
		});
		expect(JSON.parse(storage.get(STORAGE_KEY) ?? "{}").providers).toEqual(PROVIDERS);
	});

	it("keeps the cached data and flags the failure when a refresh rejects", async () => {
		fetchProviders.mockResolvedValueOnce(PROVIDERS);
		await refreshProviders(getToken);
		fetchProviders.mockRejectedValueOnce(new Error("offline"));
		await expect(refreshProviders(getToken)).rejects.toThrow("offline");
		expect(getSettingsData().providers).toEqual({
			data: PROVIDERS,
			loading: false,
			failed: true,
		});
	});

	it("shares one in-flight request per section", async () => {
		const pending = deferred<typeof PROVIDERS>();
		fetchProviders.mockReturnValueOnce(pending.promise);
		const first = refreshProviders(getToken);
		const second = refreshProviders(getToken);
		expect(second).toBe(first);
		expect(getSettingsData().providers.loading).toBe(true);
		pending.resolve(PROVIDERS);
		await first;
		expect(fetchProviders).toHaveBeenCalledTimes(1);
		expect(getSettingsData().providers.loading).toBe(false);
	});

	it("gives up on a request that never settles so the next refresh can start", async () => {
		vi.useFakeTimers();
		try {
			// A Clerk getToken that hangs offline never reaches the fetch timeout.
			fetchProviders.mockReturnValueOnce(new Promise(() => {}));
			const hung = refreshProviders(getToken);
			const rejected = expect(hung).rejects.toThrow(/could not be refreshed/);
			await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
			await rejected;
			expect(getSettingsData().providers).toEqual({ data: null, loading: false, failed: true });

			fetchProviders.mockResolvedValueOnce(PROVIDERS);
			await refreshProviders(getToken);
			expect(fetchProviders).toHaveBeenCalledTimes(2);
			expect(getSettingsData().providers.data).toEqual(PROVIDERS);
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops a response that lands after the caches changed hands", async () => {
		const pending = deferred<typeof PROVIDERS>();
		fetchProviders.mockReturnValueOnce(pending.promise);
		const request = refreshProviders(getToken);
		await clearSettingsData();
		pending.resolve(PROVIDERS);
		await request;
		await flush();
		expect(getSettingsData().providers.data).toBeNull();
		expect(storage.has(STORAGE_KEY)).toBe(false);
	});

	it("prefetch warms every section and never rejects", async () => {
		fetchProviders.mockResolvedValueOnce(PROVIDERS);
		fetchChurch.mockRejectedValueOnce(new Error("boom"));
		fetchMemories.mockResolvedValueOnce({ enabled: false, memories: [{}, {}] });
		await expect(prefetchSettingsData(getToken)).resolves.toBeUndefined();
		const snap = getSettingsData();
		expect(snap.providers.data).toEqual(PROVIDERS);
		expect(snap.church).toEqual({ data: null, loading: false, failed: true });
		expect(snap.memories.data).toEqual({ count: 2, enabled: false });
	});

	it("takes a church mutation's answer without another request", () => {
		noteChurch(CHURCH);
		expect(getSettingsData().church.data).toEqual(CHURCH);
		noteChurch({ status: "ok", church: null });
		expect(getSettingsData().church.data).toEqual({ status: "ok", church: null });
		expect(fetchChurch).not.toHaveBeenCalled();
	});

	it("keeps the memory switch when the Memories screen reports a new count", async () => {
		fetchMemories.mockResolvedValueOnce({ enabled: true, memories: [{}] });
		await refreshMemories(getToken);
		noteMemoryCount(4);
		expect(getSettingsData().memories.data).toEqual({ count: 4, enabled: true });
		noteMemoryEnabled(false);
		expect(getSettingsData().memories.data).toEqual({ count: 4, enabled: false });
	});

	it("clear empties memory and disk", async () => {
		fetchProviders.mockResolvedValueOnce(PROVIDERS);
		await refreshProviders(getToken);
		expect(storage.has(STORAGE_KEY)).toBe(true);
		await clearSettingsData();
		expect(getSettingsData().providers.data).toBeNull();
		expect(getSettingsData().hydrated).toBe(true);
		expect(storage.has(STORAGE_KEY)).toBe(false);
		// The hydrate after a clear must not read the file being deleted.
		await hydrateSettingsData();
		expect(getSettingsData().providers.data).toBeNull();
	});
});
