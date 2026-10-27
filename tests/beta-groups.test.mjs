/**
 * SureWord Groups (LC-17656, docs/beta/groups.md): the pure rules
 * (src/lib/beta/groups/groups-rules.ts), what Groups added to Study Rooms so a
 * group is a room rather than a second membership system, and the privacy
 * contract the server half (src/lib/beta/groups/groups.ts and its routes) keeps.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	GROUPS_MODULE,
	PREPARED_QUESTIONS_MAX,
	QUESTION_TYPE_LABEL,
	canAnswerPrayer,
	canDeleteGroupPost,
	canEditSession,
	canMarkPrayed,
	checkGroupPost,
	checkPrayerPatch,
	checkPreparedDraft,
	checkSessionPatch,
	cleanTopics,
	isLeader,
	parseThemes,
	passageRefs,
	passageVerseRange,
	personView,
	planWeekOf,
	planWeeks,
	prayerView,
	questionRefs,
	questionView,
	quotedSpans,
	quotesAreFromPassage,
	readSessionData,
	replyView,
	sessionNotesText,
	sessionView,
	sortPrayers,
} from "../src/lib/beta/groups/groups-rules.ts";
import { ROOM_PURPOSE_PATHS, asRole, checkAssignableRole, memberAction, roomInvitePath } from "../src/lib/beta/rooms/rooms-rules.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const OWNER = "user_owner_private_id";
const LEADER = "user_leader_private_id";
const MEMBER = "user_member_private_id";
const owner = { userId: OWNER, role: "owner" };
const leader = { userId: LEADER, role: "leader" };
const member = { userId: MEMBER, role: "member" };

// James 1:19-27 from the bundled KJV, as the server reads it.
const JAMES_1 = JSON.parse(read("src/data/kjv/59-james.json"))[0];
const JAMES_1_19_27 = JAMES_1.slice(18, 27).join(" ");

test("Rooms gained a leader, never a second membership system", () => {
	assert.equal(asRole("leader"), "leader");
	assert.equal(asRole("parent"), "member", "a role Rooms does not know still grants nothing");
	assert.equal(checkAssignableRole("leader"), "leader");
	assert.equal(checkAssignableRole("member"), "member");
	assert.equal(checkAssignableRole("owner"), null, "ownership never moves");
	assert.equal(checkAssignableRole(undefined), null);
	// A leader removes members, never the owner or another leader; Study Rooms' own rules are unchanged.
	assert.equal(memberAction(leader, member), "remove");
	assert.equal(memberAction(leader, owner), null);
	assert.equal(memberAction(leader, { userId: "user_other_leader", role: "leader" }), null);
	assert.equal(memberAction(leader, leader), "leave");
	assert.equal(memberAction(owner, leader), "remove");
	assert.equal(memberAction(member, member), "leave");
	assert.equal(memberAction(member, { userId: "user_carol", role: "member" }), null);
});

test("a room's purpose decides where it lives, and Study Rooms' routes see only study rooms", () => {
	assert.equal(roomInvitePath("AbCdEfGh_-123456"), "/beta/study/rooms/join/AbCdEfGh_-123456");
	assert.equal(roomInvitePath("AbCdEfGh_-123456", "group"), "/beta/together/groups/join/AbCdEfGh_-123456");
	assert.deepEqual(ROOM_PURPOSE_PATHS.group, { page: "/beta/together/groups", api: "/api/beta/groups" });
	const rooms = read("src/lib/beta/rooms/rooms.ts");
	assert.match(rooms, /async function requireMembership\(userId: string, roomId: string, purpose: RoomPurpose = "study"\)/);
	assert.match(rooms, /findFirst\(\{ where: \{ roomId, userId, room: \{ purpose \} \}, include: \{ room: true \} \}\)/, "membership is looked up by purpose");
	assert.match(rooms, /where: \{ inviteToken: token, archivedAt: null, purpose \}/, "an invite link joins only a room of its own purpose");
	for (const route of routeFiles("src/app/api/beta/rooms")) {
		assert.equal(/GROUP_PURPOSE|"group"/.test(read(route)), false, `${route} must keep Study Rooms' own purpose`);
	}
	assert.match(rooms, /if \(module === ROOMS_MODULE\) throw/, "another module never reaches Study Rooms' own posts");
	assert.match(rooms, /export async function setMemberRole\([^)]*\): Promise<void> \{\n\tconst me = await requireOwner\(userId, roomId, purpose\);/, "only the owner names leaders");
});

test("leaders lead: weeks, questions and sessions are theirs to manage; replies and prayers their authors'", () => {
	assert.equal(isLeader("owner"), true);
	assert.equal(isLeader("leader"), true);
	assert.equal(isLeader("member"), false);
	for (const kind of ["week", "question", "session"]) {
		assert.equal(canDeleteGroupPost({ kind, authorId: MEMBER }, member), false, `a member cannot remove a ${kind}`);
		assert.equal(canDeleteGroupPost({ kind, authorId: OWNER }, leader), true, `a leader can remove a ${kind}`);
	}
	for (const kind of ["reply", "prayer"]) {
		assert.equal(canDeleteGroupPost({ kind, authorId: MEMBER }, member), true, `the author removes their own ${kind}`);
		assert.equal(canDeleteGroupPost({ kind, authorId: LEADER }, member), false);
		assert.equal(canDeleteGroupPost({ kind, authorId: MEMBER }, leader), true, `a leader can take down a ${kind}`);
	}
	assert.equal(canDeleteGroupPost({ kind: "prayed", authorId: MEMBER }, member), false, "a prayed mark is undone by its toggle");
	assert.equal(canEditSession({ authorId: LEADER }, leader), true);
	assert.equal(canEditSession({ authorId: LEADER }, owner), false, "only the leader running it keeps its notes");
	assert.equal(canEditSession({ authorId: LEADER }, { userId: LEADER, role: "member" }), false, "and only while they still lead");
	assert.equal(canMarkPrayed({ authorId: MEMBER }, leader), true);
	assert.equal(canMarkPrayed({ authorId: MEMBER }, member), false, "the asker does not mark their own");
	assert.equal(canAnswerPrayer({ authorId: MEMBER }, member), true);
	assert.equal(canAnswerPrayer({ authorId: MEMBER }, owner), false, "only the asker marks it answered");
});

test("the group's plan reads in weeks of seven days", () => {
	assert.equal(planWeekOf(1), 1);
	assert.equal(planWeekOf(7), 1);
	assert.equal(planWeekOf(8), 2);
	assert.equal(planWeekOf(30), 5);
	assert.equal(planWeekOf(0), 1);
	const weeks = planWeeks(Array.from({ length: 30 }, (_, i) => i + 1));
	assert.equal(weeks.length, 5);
	assert.deepEqual(weeks[4], { week: 5, firstDay: 29, lastDay: 30, days: [29, 30] });
	assert.equal(planWeeks(Array.from({ length: 365 }, (_, i) => i)).length, 53);
	const plans = read("src/lib/beta/groups/groups.ts");
	assert.match(plans, /buildPresetPlan\(room\.plan\.presetKey\)/, "the weeks are the room's own preset plan, not a second plan engine");
	assert.match(plans, /followPlan|getRoomView/);
});

test("every group object carries store-shaped passage keys and topics", () => {
	assert.deepEqual(passageRefs({ book: 59, chapter: 1 }), ["59.1"]);
	assert.deepEqual(passageRefs({ book: 59, chapter: 1, verseStart: 19, verseEnd: 21 }), ["59.1", "59.1.19", "59.1.20", "59.1.21"]);
	assert.deepEqual(passageRefs({ book: 43, chapter: 3, verseStart: 16 }), ["43.3", "43.3.16"]);
	assert.deepEqual(questionRefs({ book: 59, chapter: 1, verseStart: 19, verseEnd: 27 }, [26, 19, 19]), ["59.1", "59.1.19", "59.1.26"]);
	assert.deepEqual(questionRefs({ book: 59, chapter: 1, verseStart: 19, verseEnd: 20 }, []), ["59.1", "59.1.19", "59.1.20"], "no verses means the whole passage");
	assert.deepEqual(parseThemes(" Anger, listening;  THE tongue ,, anger "), ["anger", "listening", "the tongue"]);
	assert.deepEqual(cleanTopics(["#Prayer", "x".repeat(61), 4, "prayer"]), ["prayer"]);
	assert.deepEqual(passageVerseRange({ book: 59, chapter: 1 }, 27), { first: 1, last: 27 });
	assert.deepEqual(passageVerseRange({ book: 59, chapter: 1, verseStart: 19, verseEnd: 40 }, 27), { first: 19, last: 27 });
	// The server writes them on every kind it creates.
	const source = read("src/lib/beta/groups/groups.ts");
	for (const kind of ["week", "question", "reply", "session", "prayer", "prayed"]) {
		assert.match(source, new RegExp(`kind: "${kind}"[\\s\\S]{0,140}?data: \\{ (passage, )?refs`), `${kind} carries refs and topics`);
	}
});

test("each kind of post asks only for what it needs", () => {
	assert.deepEqual(checkGroupPost({ kind: "week", reference: " James 1:19-27 ", themes: "anger, listening" }), { ok: true, value: { kind: "week", reference: "James 1:19-27", themes: ["anger", "listening"] } });
	assert.equal(checkGroupPost({ kind: "week", reference: "" }).ok, false);
	assert.equal(checkGroupPost({ kind: "week", reference: "James 1", parentId: "w1" }).ok, false, "a week is top-level");
	assert.deepEqual(checkGroupPost({ kind: "question", parentId: "w1", text: "What does James tell us to be swift to do?", type: "observe", verses: [19, 19, 20] }).value, {
		kind: "question",
		parentId: "w1",
		text: "What does James tell us to be swift to do?",
		type: "observe",
		verses: [19, 20],
	});
	assert.deepEqual(checkGroupPost({ kind: "question", parentId: "w1", draft: 2 }).value, { kind: "question", parentId: "w1", draft: 2 });
	assert.equal(checkGroupPost({ kind: "question", parentId: "w1", draft: PREPARED_QUESTIONS_MAX }).ok, false);
	assert.equal(checkGroupPost({ kind: "question", text: "Orphan?" }).ok, false, "a question belongs to a week");
	assert.equal(checkGroupPost({ kind: "question", parentId: "w1", text: "Why?", type: "doctrine" }).ok, false);
	assert.equal(checkGroupPost({ kind: "question", parentId: "w1", text: "Why?", verses: ["19"] }).ok, false);
	assert.equal(checkGroupPost({ kind: "reply", parentId: "q1", body: "   " }).ok, false);
	assert.equal(checkGroupPost({ kind: "reply", parentId: "q1", body: "x".repeat(2001) }).ok, false);
	assert.equal(checkGroupPost({ kind: "session" }).ok, false, "a session is for a week");
	assert.deepEqual(checkGroupPost({ kind: "prayer", body: " For my mother's surgery ", reference: "" }).value, { kind: "prayer", body: "For my mother's surgery", reference: null });
	assert.deepEqual(checkGroupPost({ kind: "prayer", memoryId: "m1" }).value, { kind: "prayer", memoryId: "m1" });
	assert.equal(checkGroupPost({ kind: "prayer", memoryId: "m1", body: "edited" }).ok, false, "a shared request is copied as it is");
	assert.equal(checkGroupPost({ kind: "prayer", memoryId: "../x" }).ok, false);
	assert.equal(checkGroupPost({ kind: "prayed", parentId: "p1" }).ok, false, "prayed marks come only through the prayer's toggle");
	assert.equal(checkGroupPost({ kind: "passage", reference: "Romans 5" }).ok, false, "Study Rooms' kinds are not Groups'");
	assert.equal(checkGroupPost(null).ok, false);
	assert.equal(checkGroupPost({ kind: "reply", parentId: { $ne: null }, body: "x" }).ok, false);
});

test("a session moves through read, observe, discuss and pray, and its notes are kept by step", () => {
	assert.deepEqual(checkSessionPatch({ step: 2, notes: { observe: " The tongue is a fire ", discuss: "" } }).value, { step: 2, notes: { observe: "The tongue is a fire", discuss: "" } });
	assert.deepEqual(checkSessionPatch({ end: true }).value, { end: true });
	assert.equal(checkSessionPatch({ step: 4 }).ok, false);
	assert.equal(checkSessionPatch({ notes: { sing: "x" } }).ok, false);
	assert.equal(checkSessionPatch({ notes: { read: "x".repeat(4001) } }).ok, false);
	assert.equal(checkSessionPatch({ end: false }).ok, false);
	assert.equal(checkSessionPatch({}).ok, false);
	const data = readSessionData({ step: 9, notes: { read: "Read by Ruth", pray: "For Tom's job" }, endedAt: null });
	assert.equal(data.step, 3, "a stored step out of range reads as the last");
	assert.equal(sessionNotesText(data.notes), "Read\nRead by Ruth\n\nPray\nFor Tom's job");
});

test("a prayer is marked prayed by the others, and answered by the one who asked", () => {
	assert.deepEqual(checkPrayerPatch({ prayed: true }).value, { prayed: true });
	assert.deepEqual(checkPrayerPatch({ answered: true, answer: " The scan was clear " }).value, { answered: true, answer: "The scan was clear" });
	assert.deepEqual(checkPrayerPatch({ answered: true }).value, { answered: true, answer: null });
	assert.deepEqual(checkPrayerPatch({ answered: false }).value, { answered: false });
	assert.equal(checkPrayerPatch({ prayed: true, answered: true }).ok, false);
	assert.equal(checkPrayerPatch({ answered: "yes" }).ok, false);
	assert.equal(checkPrayerPatch({ answered: true, answer: "x".repeat(601) }).ok, false);
});

test("SCRIPTURE: SureWord's drafted questions quote the KJV word for word, or not at all", () => {
	assert.deepEqual(quotedSpans(`What does it mean to be “swift to hear” and "slow to speak"? Isn't ‘the engrafted word’ enough?`), ["swift to hear", "slow to speak", "the engrafted word"]);
	assert.equal(quotesAreFromPassage(`What does James mean by "swift to hear, slow to speak"?`, JAMES_1_19_27), true, "punctuation does not matter");
	assert.equal(quotesAreFromPassage(`Why does James say “pure religion and undefiled before God”?`, JAMES_1_19_27), true);
	assert.equal(quotesAreFromPassage(`What does "be quick to listen" look like this week?`, JAMES_1_19_27), false, "a modern paraphrase in quotation marks is not Scripture");
	assert.equal(quotesAreFromPassage(`Why "swift to hea"?`, JAMES_1_19_27), false, "a fragment of a word is not a quotation");
	assert.equal(quotesAreFromPassage("In verse 19, what are we to be swift to do?", JAMES_1_19_27), true, "naming the verse needs no quotation");

	const drafts = {
		questions: [
			{ type: "apply", text: "Where this week could you be slow to wrath when you want to answer back?", verses: [19, 20] },
			{ type: "observe", text: "In verse 19, what three things does James tell his brethren to be?", verses: [19] },
			{ type: "interpret", text: "Why does James say the wrath of man worketh not the righteousness of God?", verses: [20] },
			{ type: "observe", text: `What does verse 23 compare "a man beholding his natural face in a glass" to?`, verses: [23, 24] },
			{ type: "interpret", text: `What does "be quick to listen" mean in verse 19?`, verses: [19] },
			{ type: "observe", text: "Who is blessed in his deed, according to verse 25?", verses: [32] },
			{ type: "observe", text: "In verse 19, what three things does James tell his brethren to be?", verses: [19] },
			{ type: "sermon", text: "Tell us about your week, please.", verses: [] },
		],
		leaderNote: `James writes "to the twelve tribes which are scattered abroad" (1:1); verses 19 to 27 turn from trials to hearing and doing the word. This is context, SureWord's reading.`,
		topics: ["Anger", "Doing the Word", "anger"],
	};
	const checked = checkPreparedDraft(drafts, { first: 19, last: 27, text: JAMES_1_19_27 });
	assert.ok(checked);
	assert.deepEqual(
		checked.questions.map((q) => q.type),
		["observe", "observe", "interpret", "apply"],
		"observe, then interpret, then apply",
	);
	assert.deepEqual(checked.dropped.sort(), ["duplicate", "note_quote", "quote", "type", "verses"], "the misquote, the verse outside the passage, the repeat and the unknown kind go");
	assert.equal(checked.leaderNote, null, "a note quoting a verse outside the passage is dropped, not rewritten");
	assert.deepEqual(checked.topics, ["anger", "doing the word"]);
	assert.equal(checkPreparedDraft({ questions: drafts.questions.slice(4, 6), leaderNote: null, topics: [] }, { first: 19, last: 27, text: JAMES_1_19_27 }), null, "too few survivors is no preparation");
	assert.equal(QUESTION_TYPE_LABEL.interpret, "Interpretation", "interpretation questions are labelled as interpretation");
});

test("PRIVACY: what one member sees of another is their group name and role, never their account", () => {
	const members = [
		{ id: "m-owner", userId: OWNER, role: "owner", displayName: "Proof" },
		{ id: "m-member", userId: MEMBER, role: "member", displayName: "Ruth" },
	];
	const viewer = member;
	const person = (userId) => personView(members.find((m) => m.userId === userId), viewer);
	assert.deepEqual(person(OWNER), { memberId: "m-owner", displayName: "Proof", role: "owner", isYou: false });
	assert.deepEqual(person("user_gone"), { memberId: null, displayName: "A former member", role: "member", isYou: false });
	const at = new Date("2026-10-27T03:00:00Z");
	const reply = replyView({ id: "r1", kind: "reply", authorId: OWNER, parentId: "q1", body: "Swift to hear", data: { refs: ["59.1"], mirrorId: "item_private" }, createdAt: at }, person(OWNER), viewer);
	const question = questionView(
		{ id: "q1", kind: "question", authorId: OWNER, parentId: "w1", body: "What are we to be swift to do?", data: { type: "observe", verses: [19], prepared: true, mirrorId: "item_q" }, createdAt: at },
		person(OWNER),
		viewer,
		[{ verse: 19, text: JAMES_1[18] }],
		[reply],
	);
	const session = sessionView({ id: "s1", kind: "session", authorId: OWNER, parentId: "w1", body: "", data: { step: 1, notes: { read: "Ruth read" }, endedAt: null, mirrorId: "item_s" }, createdAt: at }, person(OWNER), viewer);
	const prayer = prayerView(
		{ id: "p1", kind: "prayer", authorId: OWNER, parentId: null, body: "For my sister", data: { fromPrivateList: true, answeredAt: null, mirrorId: "item_p" }, createdAt: at },
		person(OWNER),
		viewer,
		[
			{ authorId: MEMBER, person: person(MEMBER) },
			{ authorId: MEMBER, person: person(MEMBER) },
		],
		null,
	);
	const json = JSON.stringify([reply, question, session, prayer]);
	for (const secret of [OWNER, MEMBER, "item_private", "item_q", "item_s", "item_p", "mirrorId", "userId", "authorId"]) {
		assert.equal(json.includes(secret), false, `no view carries ${secret}`);
	}
	assert.equal(question.prepared, true);
	assert.deepEqual(prayer.prayedBy.map((p) => p.displayName), ["Ruth"], "a double tap is one prayer, not two");
	assert.equal(prayer.youPrayed, true);
	assert.equal(prayer.canPray, true);
	assert.equal(prayer.canAnswer, false);
	assert.equal(prayer.fromPrivateList, true);
	assert.equal(session.canEdit, false);
	assert.equal(reply.canDelete, false);
});

test("open prayers come first, newest first; answered ones after, most recently answered first", () => {
	const view = (id, createdAt, answeredAt = null) => ({ id, createdAt, answered: answeredAt ? { at: answeredAt, note: null } : null });
	const sorted = sortPrayers([view("a", "2026-10-01"), view("b", "2026-10-03"), view("c", "2026-09-01", "2026-10-02"), view("d", "2026-09-02", "2026-10-05")]);
	assert.deepEqual(sorted.map((p) => p.id), ["b", "a", "d", "c"]);
});

function routeFiles(dir) {
	const out = [];
	const walk = (path) => {
		for (const entry of readdirSync(path)) {
			const full = join(path, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry === "route.ts") out.push(relative(repoRoot, full));
		}
	};
	walk(join(repoRoot, dir));
	return out.sort();
}

test("PRIVACY (server): Groups reads rooms only through Study Rooms, and one private thing, the caller's own prayer being shared", () => {
	const source = read("src/lib/beta/groups/groups.ts");
	const models = new Set([...source.matchAll(/\bprisma\.(\$?\w+)\./g)].map((match) => match[1]));
	assert.deepEqual([...models].sort(), ["user", "userMemory"], "no room table, no store table, no note, chat or plan");
	const prayerReads = [...source.matchAll(/prisma\.userMemory\.(\w+)\(([^)]*)\)/g)];
	assert.equal(prayerReads.length, 1, "exactly one read of a prayer request");
	assert.equal(prayerReads[0][1], "findFirst");
	assert.match(prayerReads[0][2], /where: \{ id: post\.memoryId, userId, category: "prayer" \}/, "scoped to the caller, so a foreign id copies nothing");
	assert.match(source, /prisma\.user\.findUnique\(\{ where: \{ id: userId \}, select: \{ aiConsentVersion: true, aiConsentAt: true \} \}\)/, "the user row is read for AI consent only");
	assert.match(source, /openModuleRoom\(userId, groupId, GROUP_PURPOSE, GROUPS_MODULE\)/, "every group read starts from the caller's membership");
	assert.match(source, /getRoomView\(userId, groupId, now, GROUP_PURPOSE\)/);
	for (const fn of ["createBetaItem", "updateBetaItem", "deleteBetaItem", "getBetaItem"]) assert.match(source, new RegExp(`${fn}\\(userId,`), `${fn} is called as the caller only`);
	assert.equal(/\.\.\.row\b|\.\.\.member\b|\.\.\.me\b/.test(source), false, "no row is spread into a view");
	assert.equal(GROUPS_MODULE, "groups");
});

test("SPEND: SureWord prepares questions only when a leader asks, at most three times a week", () => {
	const ai = [];
	const walk = (dir) => {
		for (const entry of readdirSync(join(repoRoot, dir))) {
			const path = `${dir}/${entry}`;
			if (statSync(join(repoRoot, path)).isDirectory()) walk(path);
			else if (/generateText|streamText|embed\(/.test(read(path))) ai.push(path);
		}
	};
	walk("src/lib/beta/groups");
	walk("src/app/api/beta/groups");
	walk("src/components/beta/groups");
	assert.deepEqual(ai, ["src/lib/beta/groups/groups-prepare.ts"], "one model call in all of Groups");
	const server = read("src/lib/beta/groups/groups.ts");
	assert.equal([...server.matchAll(/prepareGroupQuestions\(/g)].length, 1);
	assert.match(server, /export async function prepareWeek[\s\S]*?requireLeader\(group\);[\s\S]*?week\.data\.prepared >= PREPARE_PER_WEEK_MAX[\s\S]*?hasCurrentAiConsent\(user\)[\s\S]*?prepareGroupQuestions\(/, "a leader, under the weekly cap, with AI consent");
	const callers = routeFiles("src/app/api/beta/groups").filter((route) => read(route).includes("prepareWeek("));
	assert.deepEqual(callers, ["src/app/api/beta/groups/[id]/posts/[postId]/prepare/route.ts"]);
	const prompt = read("src/lib/beta/groups/groups-prepare.ts");
	assert.match(prompt, /\$\{systemPrompt\}/, "SureWord's mission leads every prompt");
	assert.match(prompt, /never quote Scripture from memory/);
	assert.match(prompt, /checkPreparedDraft\(/);
});

test("every groups route is gated, acts as the session's founder, and never touches Prisma itself", () => {
	const routes = routeFiles("src/app/api/beta/groups");
	assert.equal(routes.length, 9);
	for (const route of routes) {
		const source = read(route);
		const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\b/g)].length;
		assert.ok(handlers >= 1, `${route} has no handlers`);
		const gated = [...source.matchAll(/const gate = await requireBetaApi\(\);\n\tif \(!gate\.ok\) return gate\.response;/g)].length;
		const delegated = /return change\(params, (true|false)\)/.test(source) ? 0 : handlers;
		assert.ok(gated >= delegated && gated >= 1, `${route}: every handler starts with the beta gate`);
		assert.equal(/prisma/.test(source), false, `${route} must go through src/lib/beta/groups/groups.ts or Study Rooms`);
		assert.equal(/userId\s*[:=]\s*(body|json|req)/.test(source), false, `${route} must not take a user id from the request`);
		if (/removeMember|setInvite|followPlan|unfollowPlan|updateRoom|setMemberRole|joinRoom|previewInvite|createRoom|listRooms/.test(source)) {
			assert.match(source, /GROUP_PURPOSE/, `${route} must call Study Rooms with the group purpose`);
		}
	}
});

test("Groups is live in the registry, with its own pages", () => {
	const entry = BETA_MODULES.find((candidate) => candidate.slug === "groups");
	assert.equal(entry.status, "live");
	assert.equal(entry.issue, "LC-17656");
	assert.equal(entry.destination, "together");
	assert.ok(entry.builtOn.includes("Study Rooms"));
	for (const page of ["page.tsx", "[id]/page.tsx", "join/[token]/page.tsx"]) assert.ok(existsSync(join(repoRoot, "src/app/beta/together/groups", page)), page);
	assert.ok(existsSync(join(repoRoot, "docs/beta/groups.md")));
});
