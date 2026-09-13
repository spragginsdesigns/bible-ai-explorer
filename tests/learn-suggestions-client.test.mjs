import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
	LEARN_SUGGESTIONS_HEADING,
	LEARN_SUGGESTIONS_LEAD,
	addedConfirmation,
	learnSuggestionsView,
	loadSuggestions,
	parseSuggestions,
	suggestionKey,
} from "../src/components/learn/suggestions.ts";

/** Three suggestions in the shape GET /api/learn/suggestions returns. */
const SUGGESTIONS = [
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

const view = (overrides = {}) => learnSuggestionsView({
	suggestions: SUGGESTIONS,
	dismissed: new Set(),
	added: new Set(),
	hasCard: false,
	...overrides,
});

test("parses the contract's payload", () => {
	const rows = parseSuggestions({ suggestions: SUGGESTIONS });
	assert.equal(rows.length, 3);
	assert.deepEqual(rows.map((row) => row.reference), ["Romans 8:28", "Isaiah 53:5", "John 3:16"]);
	assert.equal(rows[0].source, "reading");
});

test("treats a missing or malformed body as no suggestions", () => {
	for (const body of [null, undefined, {}, { suggestions: null }, { suggestions: "none" }, "404 page"]) {
		assert.deepEqual(parseSuggestions(body), []);
	}
});

test("drops only the rows that break the contract", () => {
	const rows = parseSuggestions({
		suggestions: [
			SUGGESTIONS[0],
			{ ...SUGGESTIONS[1], reason: "   " },
			{ ...SUGGESTIONS[1], book: 67 },
			{ ...SUGGESTIONS[1], source: "vibes" },
			{ ...SUGGESTIONS[1], weight: "many" },
			SUGGESTIONS[2],
		],
	});
	assert.deepEqual(rows.map((row) => row.reference), ["Romans 8:28", "John 3:16"]);
});

test("keeps one row per verse and never more than five", () => {
	const repeated = parseSuggestions({ suggestions: [SUGGESTIONS[0], { ...SUGGESTIONS[0], reason: "Another reason." }] });
	assert.deepEqual(repeated.map((row) => row.reason), [SUGGESTIONS[0].reason]);

	const many = Array.from({ length: 9 }, (_, index) => ({ ...SUGGESTIONS[0], verse: index + 1, reference: `Romans 8:${index + 1}` }));
	assert.equal(parseSuggestions({ suggestions: many }).length, 5);
});

test("suggestions lead the screen when nothing is due", () => {
	const empty = view();
	assert.equal(empty.rows.length, 3);
	assert.equal(empty.lead, true);
	assert.equal(empty.showEmptyText, false);
	assert.equal(empty.heading, LEARN_SUGGESTIONS_LEAD);
});

test("suggestions sit under today's cards when a verse is due", () => {
	const beside = view({ hasCard: true });
	assert.equal(beside.rows.length, 3);
	assert.equal(beside.lead, false);
	assert.equal(beside.showEmptyText, false);
	assert.equal(beside.heading, LEARN_SUGGESTIONS_HEADING);
});

test("the old empty copy returns only with nothing due and nothing to suggest", () => {
	const nothing = view({ suggestions: [] });
	assert.deepEqual(nothing.rows, []);
	assert.equal(nothing.lead, false);
	assert.equal(nothing.showEmptyText, true);

	assert.equal(view({ suggestions: [], hasCard: true }).showEmptyText, false);
});

test("dismissing hides a row for the session", () => {
	const after = view({ dismissed: new Set([suggestionKey(SUGGESTIONS[1])]) });
	assert.deepEqual(after.rows.map((row) => row.reference), ["Romans 8:28", "John 3:16"]);
	assert.equal(after.lead, true);
});

test("adding removes the row and dismissing the rest falls back to the empty copy", () => {
	const afterAdd = view({ added: new Set([suggestionKey(SUGGESTIONS[0])]) });
	assert.deepEqual(afterAdd.rows.map((row) => row.reference), ["Isaiah 53:5", "John 3:16"]);

	const allGone = view({
		added: new Set([suggestionKey(SUGGESTIONS[0])]),
		dismissed: new Set(SUGGESTIONS.slice(1).map(suggestionKey)),
	});
	assert.deepEqual(allGone.rows, []);
	assert.equal(allGone.showEmptyText, true);
});

test("the confirmation names the verse that was added", () => {
	assert.equal(addedConfirmation("Romans 8:28"), "Added Romans 8:28 to Learn.");
});

/** A real server, so the endpoint being absent is a real 404 and not a stubbed one. */
async function withServer(handler, run) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		await run(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test("an endpoint that does not exist leaves the screen exactly as it was", async () => {
	await withServer((req, res) => {
		res.writeHead(404, { "Content-Type": "text/html" });
		res.end("<html>404: This page could not be found.</html>");
	}, async (origin) => {
		// The shape of the web screen's call: a fetch whose body is parsed.
		const rows = await loadSuggestions(async () => {
			const response = await fetch(`${origin}/api/learn/suggestions`);
			if (!response.ok) throw new Error("Could not load Learn. Please try again.");
			return response.json();
		});
		assert.deepEqual(rows, []);

		const empty = learnSuggestionsView({ suggestions: rows, dismissed: new Set(), added: new Set(), hasCard: false });
		assert.equal(empty.rows.length, 0);
		assert.equal(empty.lead, false);
		assert.equal(empty.showEmptyText, true, "the pre-existing empty copy is still the screen");

		const withCard = learnSuggestionsView({ suggestions: rows, dismissed: new Set(), added: new Set(), hasCard: true });
		assert.equal(withCard.rows.length, 0, "today's practice card is untouched");
	});
});

test("a 200 that is not the contract's payload is also no suggestions", async () => {
	await withServer((req, res) => {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<html>a login page</html>");
	}, async (origin) => {
		const rows = await loadSuggestions(async () => (await fetch(`${origin}/api/learn/suggestions`)).json());
		assert.deepEqual(rows, [], "invalid JSON rejects inside loadSuggestions and degrades");
	});
});

test("a served payload comes through the same path", async () => {
	await withServer((req, res) => {
		assert.equal(req.url, "/api/learn/suggestions");
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ suggestions: SUGGESTIONS }));
	}, async (origin) => {
		const rows = await loadSuggestions(async () => (await fetch(`${origin}/api/learn/suggestions`)).json());
		assert.deepEqual(rows.map((row) => row.reference), ["Romans 8:28", "Isaiah 53:5", "John 3:16"]);
	});
});

test("verse keys separate books, chapters and verses", () => {
	assert.equal(suggestionKey(SUGGESTIONS[0]), "45:8:28");
	assert.notEqual(suggestionKey({ book: 1, chapter: 11, verse: 1 }), suggestionKey({ book: 1, chapter: 1, verse: 11 }));
});
