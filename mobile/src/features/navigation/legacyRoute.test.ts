import { describe, expect, it, vi } from "vitest";
import { LegacyRoute } from "./LegacyRoute";

const params = { id: "note_123", book: "43", chapter: "3", verse: "16", translation: "NKJV", mode: "people", q: "Paul", tags: ["a", "b"] };
vi.mock("expo-router", () => ({ Redirect: "Redirect", useLocalSearchParams: () => params }));

describe("legacy links", () => {
	it.each(["/today/cross", "/today/plan", "/today/learn", "/today/history", "/study/timeline", "/study/atlas/[id]", "/study/notes/[id]", "/study/sermon"])("preserves every query and dynamic parameter when handing off to %s", (pathname) => {
		const result = LegacyRoute({ pathname });
		expect(result.props.href).toEqual({ pathname, params });
		expect(result.props.withAnchor).toBe(true);
	});
});
