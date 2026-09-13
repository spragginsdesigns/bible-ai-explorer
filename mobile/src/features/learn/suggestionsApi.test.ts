import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("expo-constants", () => ({
	default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { fetchLearnSuggestions } from "./api";
import { learnSuggestionsView } from "./suggestions";
import type { GetToken } from "@/lib/api";

const token: GetToken = async () => "tok";

const SUGGESTION = {
	book: 45,
	chapter: 8,
	verse: 28,
	reference: "Romans 8:28",
	text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
	reason: "You read Romans 8 on Tuesday, and Scripture points back to this verse 61 times.",
	weight: 61,
	source: "reading",
};

describe("fetchLearnSuggestions", () => {
	let fetchSpy: MockInstance<typeof fetch>;

	// Per test, matching src/lib/api.test.ts: a describe-scoped spy leaks a
	// phantom call into undici under Node's global fetch.
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});
	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it("returns the contract's rows", async () => {
		fetchSpy.mockResolvedValue(new Response(JSON.stringify({ suggestions: [SUGGESTION] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}));
		await expect(fetchLearnSuggestions(token)).resolves.toEqual([SUGGESTION]);
	});

	it("degrades to no suggestions when the endpoint does not exist", async () => {
		fetchSpy.mockResolvedValue(new Response("404: This page could not be found.", { status: 404 }));
		await expect(fetchLearnSuggestions(token)).resolves.toEqual([]);
	});

	it("degrades to no suggestions when the device is offline", async () => {
		fetchSpy.mockRejectedValue(new TypeError("Network request failed"));
		await expect(fetchLearnSuggestions(token)).resolves.toEqual([]);
	});

	it("leaves the screen's own behaviour in place after a failure", async () => {
		fetchSpy.mockResolvedValue(new Response("404: This page could not be found.", { status: 404 }));
		const rows = await fetchLearnSuggestions(token);
		const view = learnSuggestionsView({
			suggestions: rows,
			dismissed: new Set<string>(),
			added: new Set<string>(),
			hasCard: false,
		});
		expect(view.rows).toEqual([]);
		expect(view.lead).toBe(false);
		expect(view.showEmptyText).toBe(true);
	});
});
