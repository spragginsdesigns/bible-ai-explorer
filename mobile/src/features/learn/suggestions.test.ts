import { describe, expect, it } from "vitest";
import * as mobileSuggestions from "./suggestions";
import * as webSuggestions from "../../../../src/components/learn/suggestions";
import type { LearnSuggestion } from "./suggestions";

/** Three suggestions in the shape GET /api/learn/suggestions returns. */
const SUGGESTIONS: LearnSuggestion[] = [
	{
		book: 45,
		chapter: 8,
		verse: 28,
		reference: "Romans 8:28",
		text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
		reason: "You read Romans 8 on Tuesday, and Scripture points back to this verse 61 times.",
		weight: 61,
		source: "reading",
	},
	{
		book: 23,
		chapter: 53,
		verse: 5,
		reference: "Isaiah 53:5",
		text: "But he was wounded for our transgressions, he was bruised for our iniquities: the chastisement of our peace was upon him; and with his stripes we are healed.",
		reason: "You highlighted this verse, and Scripture points back to it 48 times.",
		weight: 48,
		source: "highlight",
	},
	{
		book: 43,
		chapter: 3,
		verse: 16,
		reference: "John 3:16",
		text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
		reason: "You asked about John 3 in chat, and Scripture points back to this verse 74 times.",
		weight: 74,
		source: "chat",
	},
];

for (const [client, suggestions] of [["Android", mobileSuggestions], ["web", webSuggestions]] as const) {
	const view = (overrides: Partial<mobileSuggestions.LearnSuggestionsInput> = {}) =>
		suggestions.learnSuggestionsView({
			suggestions: SUGGESTIONS,
			dismissed: new Set<string>(),
			added: new Set<string>(),
			hasCard: false,
			...overrides,
		});

	describe(`${client} Learn suggestions contract`, () => {
		it("parses the contract's payload", () => {
			const rows = suggestions.parseSuggestions({ suggestions: SUGGESTIONS });
			expect(rows.map((row) => row.reference)).toEqual(["Romans 8:28", "Isaiah 53:5", "John 3:16"]);
			expect(rows[0].source).toBe("reading");
		});

		it("treats a missing or malformed body as no suggestions", () => {
			for (const body of [null, undefined, {}, { suggestions: null }, { suggestions: "none" }, "404 page"]) {
				expect(suggestions.parseSuggestions(body)).toEqual([]);
			}
		});

		it("drops only the rows that break the contract", () => {
			const rows = suggestions.parseSuggestions({
				suggestions: [
					SUGGESTIONS[0],
					{ ...SUGGESTIONS[1], reason: "   " },
					{ ...SUGGESTIONS[1], book: 67 },
					{ ...SUGGESTIONS[1], source: "vibes" },
					{ ...SUGGESTIONS[1], weight: "many" },
					SUGGESTIONS[2],
				],
			});
			expect(rows.map((row) => row.reference)).toEqual(["Romans 8:28", "John 3:16"]);
		});

		it("reads the GET vocabulary, not the POST vocabulary", () => {
			// A row names why the verse was chosen. "suggestion" is what the
			// client POSTs back when adding one, and is never a signal.
			for (const source of ["highlight", "reading", "chat", "cross", "note"]) {
				const rows = suggestions.parseSuggestions({ suggestions: [{ ...SUGGESTIONS[0], source }] });
				expect(rows[0].source).toBe(source);
			}
			for (const source of ["suggestion", "sheet", "reading ", "Reading", ""]) {
				expect(suggestions.parseSuggestions({ suggestions: [{ ...SUGGESTIONS[0], source }] })).toEqual([]);
			}
		});

		it("accepts the fallback row that has no personal signal", () => {
			const fallback = {
				...SUGGESTIONS[0],
				source: "reading" as const,
				reason: "You have no recent marks or reading to go on, so this is one of the verses the rest of " +
					"Scripture leans on most in Romans 8, the last chapter you read, and Scripture points back to it 86 times.",
			};
			const rows = suggestions.parseSuggestions({ suggestions: [fallback] });
			expect(rows).toHaveLength(1);
			expect(rows[0].reason).toBe(fallback.reason);
		});

		it("keeps one row per verse and never more than five", () => {
			const repeated = suggestions.parseSuggestions({
				suggestions: [SUGGESTIONS[0], { ...SUGGESTIONS[0], reason: "Another reason." }],
			});
			expect(repeated.map((row) => row.reason)).toEqual([SUGGESTIONS[0].reason]);

			const many = Array.from({ length: 9 }, (_, index) => ({
				...SUGGESTIONS[0],
				verse: index + 1,
				reference: `Romans 8:${index + 1}`,
			}));
			expect(suggestions.parseSuggestions({ suggestions: many })).toHaveLength(5);
		});

		it("leads the screen when nothing is due", () => {
			const empty = view();
			expect(empty.rows).toHaveLength(3);
			expect(empty.lead).toBe(true);
			expect(empty.showEmptyText).toBe(false);
			expect(empty.heading).toBe(suggestions.LEARN_SUGGESTIONS_LEAD);
		});

		it("sits under today's cards when a verse is due", () => {
			const beside = view({ hasCard: true });
			expect(beside.rows).toHaveLength(3);
			expect(beside.lead).toBe(false);
			expect(beside.heading).toBe(suggestions.LEARN_SUGGESTIONS_HEADING);
		});

		it("returns the old empty copy only with nothing due and nothing to suggest", () => {
			const nothing = view({ suggestions: [] });
			expect(nothing.rows).toEqual([]);
			expect(nothing.showEmptyText).toBe(true);
			expect(view({ suggestions: [], hasCard: true }).showEmptyText).toBe(false);
		});

		it("hides a dismissed row for the session", () => {
			const after = view({ dismissed: new Set([suggestions.suggestionKey(SUGGESTIONS[1])]) });
			expect(after.rows.map((row) => row.reference)).toEqual(["Romans 8:28", "John 3:16"]);
			expect(after.lead).toBe(true);
		});

		it("removes an added row and falls back to the empty copy once all are gone", () => {
			const afterAdd = view({ added: new Set([suggestions.suggestionKey(SUGGESTIONS[0])]) });
			expect(afterAdd.rows.map((row) => row.reference)).toEqual(["Isaiah 53:5", "John 3:16"]);

			const allGone = view({
				added: new Set([suggestions.suggestionKey(SUGGESTIONS[0])]),
				dismissed: new Set(SUGGESTIONS.slice(1).map(suggestions.suggestionKey)),
			});
			expect(allGone.rows).toEqual([]);
			expect(allGone.showEmptyText).toBe(true);
		});

		it("names the verse in the confirmation", () => {
			expect(suggestions.addedConfirmation("Romans 8:28")).toBe("Added Romans 8:28 to Learn.");
		});

		it("separates books, chapters and verses in a key", () => {
			expect(suggestions.suggestionKey(SUGGESTIONS[0])).toBe("45:8:28");
			expect(suggestions.suggestionKey({ book: 1, chapter: 11, verse: 1 }))
				.not.toBe(suggestions.suggestionKey({ book: 1, chapter: 1, verse: 11 }));
		});
	});
}
