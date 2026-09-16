/**
 * Answer feedback (docs/FEATURES.md, "Answer feedback, and how it reaches the
 * doctrinal eval harness"): the validation rules as pure functions, and the
 * PATCH route's contract driven through a fake Prisma so every branch is
 * exercised without a database.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

const { parseFeedbackPatch, answerFeedbackResponse, MAX_FEEDBACK_REASON_LENGTH } = loadModule(
	"../src/lib/chat/answer-feedback.ts",
	["parseFeedbackPatch", "answerFeedbackResponse", "MAX_FEEDBACK_REASON_LENGTH"]
);

const NOW = new Date("2026-09-15T17:30:00.000Z");

// -- the rules ---------------------------------------------------------------

test("a body with no feedback field leaves the columns alone", () => {
	for (const body of [{}, { content: "edited" }, { metadata: { parts: [] } }, null, "up", [1]]) {
		assert.deepEqual(parseFeedbackPatch(body, NOW), { ok: true, data: null });
	}
});

test("a thumb stamps all three columns and only down keeps a reason", () => {
	assert.deepEqual(parseFeedbackPatch({ feedback: "up" }, NOW).data, {
		feedback: "up",
		feedbackReason: null,
		feedbackAt: NOW,
	});
	assert.deepEqual(
		parseFeedbackPatch({ feedback: "down", feedbackReason: "  Misquoted the verse.  " }, NOW).data,
		{ feedback: "down", feedbackReason: "Misquoted the verse.", feedbackAt: NOW }
	);
	// A reason is meaningless beside a thumbs up, so it is dropped, not a 400.
	assert.equal(
		parseFeedbackPatch({ feedback: "up", feedbackReason: "loved it" }, NOW).data.feedbackReason,
		null
	);
	// Whitespace-only is the Skip button, not a reason.
	assert.equal(
		parseFeedbackPatch({ feedback: "down", feedbackReason: "   " }, NOW).data.feedbackReason,
		null
	);
});

test("null clears the thumb, the reason and the stamp together", () => {
	assert.deepEqual(parseFeedbackPatch({ feedback: null, feedbackReason: "stale" }, NOW).data, {
		feedback: null,
		feedbackReason: null,
		feedbackAt: null,
	});
});

test("only the three documented values are accepted", () => {
	for (const value of ["UP", "Down", "", 1, true, {}, ["up"], "thumbs-up"]) {
		const parsed = parseFeedbackPatch({ feedback: value }, NOW);
		assert.equal(parsed.ok, false, `accepted ${JSON.stringify(value)}`);
		assert.match(parsed.error, /feedback must be/);
	}
});

test("an oversized or non-string reason is rejected whatever the thumb is", () => {
	assert.equal(MAX_FEEDBACK_REASON_LENGTH, 500);
	const tooLong = "x".repeat(MAX_FEEDBACK_REASON_LENGTH + 1);
	for (const feedback of ["down", "up", null]) {
		const parsed = parseFeedbackPatch({ feedback, feedbackReason: tooLong }, NOW);
		assert.equal(parsed.ok, false, `accepted ${MAX_FEEDBACK_REASON_LENGTH + 1} chars with ${feedback}`);
		assert.match(parsed.error, /500 characters or fewer/);
	}
	// Exactly at the cap, and a long reason that trims down to the cap, both pass.
	const atCap = "y".repeat(MAX_FEEDBACK_REASON_LENGTH);
	assert.equal(parseFeedbackPatch({ feedback: "down", feedbackReason: atCap }, NOW).data.feedbackReason, atCap);
	assert.equal(
		parseFeedbackPatch({ feedback: "down", feedbackReason: `  ${atCap}  ` }, NOW).data.feedbackReason,
		atCap
	);
	const nonString = parseFeedbackPatch({ feedback: "down", feedbackReason: 42 }, NOW);
	assert.equal(nonString.ok, false);
	assert.match(nonString.error, /must be a string/);
	// An explicit null reason is "no reason", not a bad type.
	assert.equal(parseFeedbackPatch({ feedback: "down", feedbackReason: null }, NOW).ok, true);
});

test("the stamp is a copy, so a later mutation of `now` cannot move it", () => {
	const clock = new Date(NOW.getTime());
	const { feedbackAt } = parseFeedbackPatch({ feedback: "up" }, clock).data;
	clock.setFullYear(2099);
	assert.equal(feedbackAt.toISOString(), NOW.toISOString());
});

test("the response serializes feedbackAt as ISO or null and never leaks a stray value", () => {
	assert.deepEqual(
		answerFeedbackResponse({ id: "m1", feedback: "down", feedbackReason: "why", feedbackAt: NOW }),
		{ id: "m1", feedback: "down", feedbackReason: "why", feedbackAt: NOW.toISOString() }
	);
	assert.deepEqual(
		answerFeedbackResponse({ id: "m2", feedback: null, feedbackReason: null, feedbackAt: null }),
		{ id: "m2", feedback: null, feedbackReason: null, feedbackAt: null }
	);
	// A value written by some future build degrades to null rather than escaping.
	assert.equal(
		answerFeedbackResponse({ id: "m3", feedback: "sideways", feedbackReason: null, feedbackAt: null })
			.feedback,
		null
	);
});

// -- the route ---------------------------------------------------------------

const ROUTE = "../src/app/api/conversations/[id]/messages/[messageId]/route.ts";

const NextResponse = {
	json: (body, init) => ({ status: init?.status ?? 200, body }),
};

const unauthorized = () => {
	throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
		status: 401,
		headers: { "Content-Type": "application/json" },
	});
};

function patchRoute({ owned = true, role = "assistant", exists = true, auth } = {}) {
	const calls = [];
	const prisma = {
		conversation: {
			findFirst: async (args) => {
				calls.push(["conversation.findFirst", args]);
				return owned ? { id: args.where.id, userId: args.where.userId } : null;
			},
		},
		message: {
			findFirst: async (args) => {
				calls.push(["message.findFirst", args]);
				return exists ? { role } : null;
			},
			update: async (args) => {
				calls.push(["message.update", args]);
				return {
					id: args.where.id,
					role,
					content: args.data.content ?? "stored answer",
					metadata: args.data.metadata ?? null,
					feedback: "feedback" in args.data ? args.data.feedback : null,
					feedbackReason: "feedbackReason" in args.data ? args.data.feedbackReason : null,
					feedbackAt: "feedbackAt" in args.data ? args.data.feedbackAt : null,
				};
			},
		},
	};
	const { PATCH } = loadModule(ROUTE, ["PATCH"], {
		NextResponse,
		prisma,
		getAuthUser: auth ?? (async () => "user_alice"),
		parseFeedbackPatch: (body) => parseFeedbackPatch(body, NOW),
		answerFeedbackResponse,
	});
	return {
		calls,
		send: (body) =>
			PATCH(
				{ json: async () => body },
				{ params: Promise.resolve({ id: "convo-1", messageId: "msg-1" }) }
			),
	};
}

const names = (calls) => calls.map(([name]) => name);
const dataOf = (calls) => calls.find(([name]) => name === "message.update")[1].data;

test("a thumb writes all three columns and answers with just the feedback fields", async () => {
	const route = patchRoute();
	const response = await route.send({ feedback: "down", feedbackReason: " wrong verse " });
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, {
		id: "msg-1",
		feedback: "down",
		feedbackReason: "wrong verse",
		feedbackAt: NOW.toISOString(),
	});
	assert.deepEqual(dataOf(route.calls), {
		feedback: "down",
		feedbackReason: "wrong verse",
		feedbackAt: NOW,
	});
});

test("clearing writes three nulls rather than leaving a dangling reason", async () => {
	const route = patchRoute();
	const response = await route.send({ feedback: null });
	assert.deepEqual(dataOf(route.calls), { feedback: null, feedbackReason: null, feedbackAt: null });
	assert.deepEqual(response.body, {
		id: "msg-1",
		feedback: null,
		feedbackReason: null,
		feedbackAt: null,
	});
});

test("only an assistant message can be rated, and the refusal writes nothing", async () => {
	const route = patchRoute({ role: "user" });
	const response = await route.send({ feedback: "up" });
	assert.equal(response.status, 400);
	assert.deepEqual(response.body, { error: "Only an answer can be rated." });
	assert.ok(!names(route.calls).includes("message.update"));
});

test("a bad thumb or an oversized reason is a 400 that never reaches the row", async () => {
	for (const body of [{ feedback: "sideways" }, { feedback: "down", feedbackReason: "x".repeat(501) }]) {
		const route = patchRoute();
		const response = await route.send(body);
		assert.equal(response.status, 400, JSON.stringify(body));
		// Rejected before the role lookup as well as before the write.
		assert.deepEqual(names(route.calls), ["conversation.findFirst"]);
	}
});

test("a conversation the caller does not own is 404 before the body is read", async () => {
	const route = patchRoute({ owned: false });
	const response = await route.send({ feedback: "up" });
	assert.equal(response.status, 404);
	assert.deepEqual(names(route.calls), ["conversation.findFirst"]);
	assert.deepEqual(route.calls[0][1].where, { id: "convo-1", userId: "user_alice" });
});

test("a message id outside the owned conversation is 404, not a create", async () => {
	const route = patchRoute({ exists: false });
	const response = await route.send({ feedback: "up" });
	assert.equal(response.status, 404);
	assert.ok(!names(route.calls).includes("message.update"));
	// The role lookup is scoped to the conversation already proven to be theirs.
	assert.deepEqual(route.calls[1][1].where, { id: "msg-1", conversationId: "convo-1" });
});

test("the original content/metadata edit still returns the whole row untouched", async () => {
	const route = patchRoute();
	const response = await route.send({ content: "edited", metadata: { parts: [] } });
	assert.equal(response.status, 200);
	assert.deepEqual(dataOf(route.calls), { content: "edited", metadata: { parts: [] } });
	// No thumb in the body means no role lookup and no feedback columns written.
	assert.deepEqual(names(route.calls), ["conversation.findFirst", "message.update"]);
	assert.equal(response.body.content, "edited");
});

test("no session is the 401 Response, re-returned rather than reported as a 500", async () => {
	const route = patchRoute({ auth: async () => unauthorized() });
	const response = await route.send({ feedback: "up" });
	assert.ok(response instanceof Response);
	assert.equal(response.status, 401);
	assert.deepEqual(route.calls, []);
});

test("a body that is not JSON is a no-op edit, not a 500", async () => {
	const route = patchRoute();
	const { PATCH } = loadModule(ROUTE, ["PATCH"], {
		NextResponse,
		prisma: {
			conversation: { findFirst: async () => ({ id: "convo-1" }) },
			message: {
				findFirst: async () => ({ role: "assistant" }),
				update: async (args) => ({ id: "msg-1", ...args.data, feedback: null, feedbackReason: null, feedbackAt: null }),
			},
		},
		getAuthUser: async () => "user_alice",
		parseFeedbackPatch: (body) => parseFeedbackPatch(body, NOW),
		answerFeedbackResponse,
	});
	const response = await PATCH(
		{
			json: async () => {
				throw new SyntaxError("Unexpected token");
			},
		},
		{ params: Promise.resolve({ id: "convo-1", messageId: "msg-1" }) }
	);
	assert.equal(response.status, 200);
	assert.equal(route.calls.length, 0);
});

// -- history replay ----------------------------------------------------------

test("the conversation GET returns whole Message rows, so the thumb replays", () => {
	const source = read("../src/app/api/conversations/[id]/route.ts");
	const get = source.slice(source.indexOf("export async function GET"), source.indexOf("const MAX_CONVERSATION_TITLE_LENGTH"));
	// A `select:` on messages here would silently drop feedback, feedbackReason
	// and feedbackAt from history; the handler must keep spreading the row.
	assert.ok(!/messages:\s*\{[^}]*select:/s.test(get), "GET narrows messages with a select");
	assert.match(get, /\.\.\.message\b/);
});

test("the three feedback columns exist on Message and are indexed for the harness", () => {
	const schema = read("../prisma/schema.prisma");
	const model = schema.slice(schema.indexOf("model Message {"));
	const body = model.slice(0, model.indexOf("\n}"));
	for (const column of ["feedback", "feedbackReason", "feedbackAt"]) {
		assert.match(body, new RegExp(`^\\s+${column}\\s`, "m"), `Message has no ${column}`);
	}
	// scripts/feedback-to-fixtures.mjs scans by feedback and date.
	assert.match(body, /@@index\(\[feedback, feedbackAt\]\)/);
});
