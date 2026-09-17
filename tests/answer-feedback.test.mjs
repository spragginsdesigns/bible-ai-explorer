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

const { parseFeedbackPatch, answerFeedbackResponse, MAX_FEEDBACK_REASON_LENGTH, FEEDBACK_TAGS } =
	loadModule("../src/lib/chat/answer-feedback.ts", [
		"parseFeedbackPatch",
		"answerFeedbackResponse",
		"MAX_FEEDBACK_REASON_LENGTH",
		"FEEDBACK_TAGS",
	]);

const NOW = new Date("2026-09-15T17:30:00.000Z");
const CLEARED = { feedback: null, feedbackReason: null, feedbackTags: [], feedbackAt: null };

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
		feedbackTags: [],
		feedbackAt: NOW,
	});
	assert.deepEqual(
		parseFeedbackPatch({ feedback: "down", feedbackReason: "  Misquoted the verse.  " }, NOW).data,
		{ feedback: "down", feedbackReason: "Misquoted the verse.", feedbackTags: [], feedbackAt: NOW }
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

test("null clears the thumb, the reason, the tags and the stamp together", () => {
	assert.deepEqual(
		parseFeedbackPatch({ feedback: null, feedbackReason: "stale", feedbackTags: ["too-long"] }, NOW)
			.data,
		CLEARED
	);
});

test("reason chips ride only with a thumbs down, in tap order, without repeats", () => {
	assert.deepEqual(
		parseFeedbackPatch(
			{ feedback: "down", feedbackTags: ["too-long", "not-kjv", "too-long"], feedbackReason: "" },
			NOW
		).data,
		{ feedback: "down", feedbackReason: null, feedbackTags: ["too-long", "not-kjv"], feedbackAt: NOW }
	);
	// Chips beside a thumbs up are as meaningless as a reason there: dropped, not a 400.
	assert.deepEqual(parseFeedbackPatch({ feedback: "up", feedbackTags: ["doctrine"] }, NOW).data.feedbackTags, []);
	// An explicit null or a missing field both mean "no chips".
	assert.deepEqual(parseFeedbackPatch({ feedback: "down", feedbackTags: null }, NOW).data.feedbackTags, []);
	assert.deepEqual(parseFeedbackPatch({ feedback: "down" }, NOW).data.feedbackTags, []);
});

test("an unknown chip or a non-array is a 400 whatever the thumb is", () => {
	for (const feedback of ["down", "up", null]) {
		for (const feedbackTags of [["helpful"], ["not-kjv", "NOT-KJV"], "too-long", { id: "too-long" }, [1]]) {
			const parsed = parseFeedbackPatch({ feedback, feedbackTags }, NOW);
			assert.equal(parsed.ok, false, `accepted ${JSON.stringify(feedbackTags)} with ${feedback}`);
			assert.match(parsed.error, /feedback tag|feedbackTags must be/);
		}
	}
});

test("the chip list is five distinct ids with user-facing labels, mirrored on every client", () => {
	assert.equal(FEEDBACK_TAGS.length, 5);
	const ids = FEEDBACK_TAGS.map((tag) => tag.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const tag of FEEDBACK_TAGS) {
		assert.match(tag.id, /^[a-z-]+$/);
		assert.ok(tag.label.length > 0 && tag.label.length <= 24, `label too long: ${tag.label}`);
	}
	// Each client keeps its own copy of the list (no shared package across the
	// three trees), so the copies are pinned to this one, id and label alike.
	const mirrors = ["../mobile/src/lib/answerFeedback.ts", "../macos/Shared/Chat/AnswerFeedback.swift"];
	for (const mirror of mirrors) {
		const source = read(mirror);
		for (const tag of FEEDBACK_TAGS) {
			assert.ok(source.includes(`"${tag.id}"`), `${mirror} lacks tag id ${tag.id}`);
			assert.ok(source.includes(`"${tag.label}"`), `${mirror} lacks tag label ${tag.label}`);
		}
	}
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
		answerFeedbackResponse({
			id: "m1",
			feedback: "down",
			feedbackReason: "why",
			feedbackTags: ["not-kjv", "sideways"],
			feedbackAt: NOW,
		}),
		{ id: "m1", feedback: "down", feedbackReason: "why", feedbackTags: ["not-kjv"], feedbackAt: NOW.toISOString() }
	);
	assert.deepEqual(
		answerFeedbackResponse({ id: "m2", feedback: null, feedbackReason: null, feedbackAt: null }),
		{ id: "m2", ...CLEARED }
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
					feedbackTags: "feedbackTags" in args.data ? args.data.feedbackTags : [],
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
	const response = await route.send({
		feedback: "down",
		feedbackReason: " wrong verse ",
		feedbackTags: ["wrong-verse"],
	});
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, {
		id: "msg-1",
		feedback: "down",
		feedbackReason: "wrong verse",
		feedbackTags: ["wrong-verse"],
		feedbackAt: NOW.toISOString(),
	});
	assert.deepEqual(dataOf(route.calls), {
		feedback: "down",
		feedbackReason: "wrong verse",
		feedbackTags: ["wrong-verse"],
		feedbackAt: NOW,
	});
});

test("clearing writes the empty state rather than leaving a dangling reason or chip", async () => {
	const route = patchRoute();
	const response = await route.send({ feedback: null });
	assert.deepEqual(dataOf(route.calls), CLEARED);
	assert.deepEqual(response.body, { id: "msg-1", ...CLEARED });
});

test("only an assistant message can be rated, and the refusal writes nothing", async () => {
	const route = patchRoute({ role: "user" });
	const response = await route.send({ feedback: "up" });
	assert.equal(response.status, 400);
	assert.deepEqual(response.body, { error: "Only an answer can be rated." });
	assert.ok(!names(route.calls).includes("message.update"));
});

test("a bad thumb or an oversized reason is a 400 that never reaches the row", async () => {
	for (const body of [
		{ feedback: "sideways" },
		{ feedback: "down", feedbackReason: "x".repeat(501) },
		{ feedback: "down", feedbackTags: ["helpful"] },
	]) {
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

test("the four feedback columns exist on Message and are indexed for the harness", () => {
	const schema = read("../prisma/schema.prisma");
	const model = schema.slice(schema.indexOf("model Message {"));
	const body = model.slice(0, model.indexOf("\n}"));
	for (const column of ["feedback", "feedbackReason", "feedbackTags", "feedbackAt"]) {
		assert.match(body, new RegExp(`^\\s+${column}\\s`, "m"), `Message has no ${column}`);
	}
	// scripts/feedback-to-fixtures.mjs scans by feedback and date.
	assert.match(body, /@@index\(\[feedback, feedbackAt\]\)/);
});
