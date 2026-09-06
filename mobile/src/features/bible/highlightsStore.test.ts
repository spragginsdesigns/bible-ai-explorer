import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: (effect: () => void) => effect(),
		useMemo: <T>(factory: () => T) => factory(),
		useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
	};
});

vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: vi.fn(async () => null),
		setItem: vi.fn(async () => undefined),
		removeItem: vi.fn(async () => undefined),
	},
}));

vi.mock("@/features/notes/useStableGetToken", () => ({
	useStableGetToken: () => vi.fn(async () => "token"),
}));

vi.mock("@/lib/api", () => ({
	apiJson: vi.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiJson } from "@/lib/api";
import {
	clearHighlightsCache,
	removeHighlight,
	setHighlight,
	useChapterHighlights,
} from "./highlightsStore";

const mockedApiJson = vi.mocked(apiJson);
const ref = { translation: "KJV" as const, book: 43, chapter: 3, verse: 16 };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function cachedHighlights(): Record<string, string> {
	const calls = vi.mocked(AsyncStorage.setItem).mock.calls;
	const latest = calls.at(-1)?.[1];
	return latest ? (JSON.parse(latest) as Record<string, string>) : {};
}

async function flushQueue() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(async () => {
	await clearHighlightsCache();
	vi.clearAllMocks();
});

describe("highlight write ordering", () => {
	it("serializes rapid recolors and leaves the newest intent visible", async () => {
		const first = deferred<unknown>();
		const second = deferred<unknown>();
		mockedApiJson.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const red = setHighlight(vi.fn(), { ...ref, color: "#e84c3d" });
		const blue = setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		await flushQueue();
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
		expect(mockedApiJson).toHaveBeenCalledTimes(1);

		first.resolve({});
		await flushQueue();
		expect(mockedApiJson).toHaveBeenCalledTimes(2);
		expect(mockedApiJson.mock.calls[1]?.[2]).toMatchObject({ body: { color: "#4A90D9" } });
		second.resolve({});
		await Promise.all([red, blue]);
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
	});

	it("rolls a failed latest write back to the last persisted value and recovers", async () => {
		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#f5d76e" });

		mockedApiJson.mockRejectedValueOnce(new Error("offline"));
		await expect(setHighlight(vi.fn(), { ...ref, color: "#e84c3d" })).rejects.toThrow("offline");
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#F5D76E");

		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
	});

	it("serializes a recolor followed by delete", async () => {
		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#f5d76e" });
		const recolor = deferred<unknown>();
		const remove = deferred<unknown>();
		mockedApiJson.mockReturnValueOnce(recolor.promise).mockReturnValueOnce(remove.promise);

		const blue = setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		const deleted = removeHighlight(vi.fn(), ref);
		await flushQueue();
		recolor.reject(new Error("offline"));
		await flushQueue();
		expect(mockedApiJson.mock.calls[2]?.[2]).toMatchObject({ method: "DELETE" });
		remove.resolve({});
		await expect(blue).rejects.toThrow("offline");
		await deleted;
		expect(cachedHighlights()["KJV:43:3:16"]).toBeUndefined();
	});

	it("does not let a stale chapter response overwrite a local write", async () => {
		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#f5d76e" });
		const chapter = deferred<{ highlights: { verse: number; color: string }[] }>();
		mockedApiJson.mockReturnValueOnce(chapter.promise);
		useChapterHighlights("KJV", 43, 3);

		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		chapter.resolve({ highlights: [{ verse: 16, color: "#E84C3D" }] });
		await flushQueue();
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
	});

	it("does not let a chapter GET overwrite a pending write or its rollback baseline", async () => {
		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#f5d76e" });
		const put = deferred<unknown>();
		const chapter = deferred<{ highlights: { verse: number; color: string }[] }>();
		mockedApiJson.mockReturnValueOnce(put.promise).mockReturnValueOnce(chapter.promise);

		const write = setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		await flushQueue();
		useChapterHighlights("KJV", 43, 3);
		chapter.resolve({ highlights: [{ verse: 16, color: "#E84C3D" }] });
		await flushQueue();
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");

		put.reject(new Error("offline"));
		await expect(write).rejects.toThrow("offline");
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#F5D76E");
	});

	it("allows a later refresh to restore a server highlight after a delete tombstone", async () => {
		mockedApiJson.mockResolvedValueOnce({});
		await setHighlight(vi.fn(), { ...ref, color: "#f5d76e" });
		mockedApiJson.mockResolvedValueOnce({});
		await removeHighlight(vi.fn(), ref);

		const chapter = deferred<{ highlights: { verse: number; color: string }[] }>();
		mockedApiJson.mockReturnValueOnce(chapter.promise);
		useChapterHighlights("KJV", 43, 3);
		chapter.resolve({ highlights: [{ verse: 16, color: "#4A90D9" }] });
		await flushQueue();
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
	});

	it("lets a fresh account GET proceed while an old account GET is pending", async () => {
		const oldChapter = deferred<{ highlights: { verse: number; color: string }[] }>();
		mockedApiJson.mockReturnValueOnce(oldChapter.promise);
		useChapterHighlights("KJV", 43, 3);
		await clearHighlightsCache();

		const freshChapter = deferred<{ highlights: { verse: number; color: string }[] }>();
		mockedApiJson.mockReturnValueOnce(freshChapter.promise);
		useChapterHighlights("KJV", 43, 3);
		freshChapter.resolve({ highlights: [{ verse: 16, color: "#4A90D9" }] });
		await flushQueue();
		oldChapter.resolve({ highlights: [] });
		await flushQueue();
		expect(cachedHighlights()["KJV:43:3:16"]).toBe("#4A90D9");
		expect(mockedApiJson).toHaveBeenCalledTimes(2);
	});

	it("invalidates in-flight and queued writes when the account cache is cleared", async () => {
		const first = deferred<unknown>();
		mockedApiJson.mockReturnValueOnce(first.promise);
		const red = setHighlight(vi.fn(), { ...ref, color: "#e84c3d" });
		const blue = setHighlight(vi.fn(), { ...ref, color: "#4a90d9" });
		await flushQueue();
		await clearHighlightsCache();

		first.resolve({});
		await Promise.all([red, blue]);
		expect(mockedApiJson).toHaveBeenCalledTimes(1);
		expect(vi.mocked(AsyncStorage.removeItem)).toHaveBeenCalledWith("sureword.highlights-cache.v1");
	});
});
