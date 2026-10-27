/**
 * Study Rooms (LC-17647, docs/beta/rooms.md): the pure rules
 * (src/lib/beta/rooms/rooms-rules.ts) and the privacy contract the server half
 * (src/lib/beta/rooms/rooms.ts and its routes) must keep.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	NOTE_MAX,
	PASSAGE_VERSES_SHOWN_MAX,
	QUESTION_MAX,
	ROOM_NAME_MAX,
	canDeletePost,
	checkDisplayName,
	checkPostInput,
	checkRoomInput,
	checkRoomPatch,
	cleanText,
	ROOMS_MODULE,
	initialsOf,
	isRoomInviteToken,
	memberAction,
	memberView,
	normalizePassage,
	passageLabel,
	passageVerseNumbers,
	postView,
	progressView,
	readerHref,
	roomInvitePath,
	snapshotSharedNote,
	storedPassage,
	threadPosts,
} from "../src/lib/beta/rooms/rooms-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const ALICE = "user_alice_private_id";
const BOB = "user_bob_private_id";
const owner = { userId: ALICE, role: "owner" };
const member = { userId: BOB, role: "member" };

test("an invite link is a 16-character base64url capability, checked before any query", () => {
	assert.equal(isRoomInviteToken("AbCdEfGh_-123456"), true);
	for (const bad of ["", "short", "AbCdEfGh_-1234567", "AbCdEfGh/-123456", "../../etc/passwd", null, 16]) assert.equal(isRoomInviteToken(bad), false, String(bad));
	assert.equal(roomInvitePath("AbCdEfGh_-123456"), "/beta/study/rooms/join/AbCdEfGh_-123456");
	const rooms = read("src/lib/beta/rooms/rooms.ts");
	assert.match(rooms, /randomBytes\(12\)\.toString\("base64url"\)/, "minted like SharedAnswer's id, never derived from the room id");
});

test("a room needs a name and a name for its owner; the description is optional", () => {
	const ok = checkRoomInput({ name: "  Thursday   night Romans ", description: " Romans,\r\n\r\n\r\ntogether  ", displayName: " Mary " });
	assert.deepEqual(ok, { ok: true, value: { name: "Thursday night Romans", description: "Romans,\n\ntogether", displayName: "Mary" } });
	assert.equal(checkRoomInput({ name: "Kitchen table", displayName: "Jay" }).value.description, null);
	assert.equal(checkRoomInput({ name: "Kitchen table", description: "   ", displayName: "Jay" }).value.description, null);
	assert.equal(checkRoomInput({ name: "  ", displayName: "Jay" }).ok, false);
	assert.equal(checkRoomInput({ name: "x".repeat(ROOM_NAME_MAX + 1), displayName: "Jay" }).ok, false);
	assert.equal(checkRoomInput({ name: "Room", description: "x".repeat(301), displayName: "Jay" }).ok, false);
	assert.equal(checkRoomInput({ name: "Room", displayName: "" }).ok, false);
	assert.equal(checkRoomInput(null).ok, false);
	assert.equal(checkDisplayName("x".repeat(41)).ok, false);
	assert.equal(cleanText("  a  \n\n\n\n b ", 10), "a\n\n b", "blank-line runs fold to one; a line keeps its own indent");
});

test("only the owner's patch fields are accepted, and only real reading plans", () => {
	const presets = ["gospels-30", "psalms-proverbs-31"];
	assert.deepEqual(checkRoomPatch({ planPresetKey: "gospels-30" }, presets), { ok: true, value: { planPresetKey: "gospels-30" } });
	assert.deepEqual(checkRoomPatch({ planPresetKey: null }, presets), { ok: true, value: { planPresetKey: null } });
	assert.deepEqual(checkRoomPatch({ archived: true, description: "" }, presets), { ok: true, value: { archived: true, description: null } });
	assert.equal(checkRoomPatch({ planPresetKey: "made-up" }, presets).ok, false);
	assert.equal(checkRoomPatch({ archived: "yes" }, presets).ok, false);
	assert.equal(checkRoomPatch({}, presets).ok, false, "an empty patch is a mistake, not a no-op");
	assert.equal(checkRoomPatch({ ownerId: BOB }, presets).ok, false, "ownership cannot be handed over by a patch");
	assert.equal(checkRoomPatch([], presets).ok, false);
});

test("passages stay inside one real chapter, and long ranges are clamped and capped", () => {
	assert.deepEqual(normalizePassage({ book: 45, chapter: 5 }, 21), { book: 45, chapter: 5 });
	assert.deepEqual(normalizePassage({ book: 45, chapter: 5, verseStart: 1, verseEnd: 11 }, 21), { book: 45, chapter: 5, verseStart: 1, verseEnd: 11 });
	assert.deepEqual(normalizePassage({ book: 45, chapter: 5, verseStart: 8, verseEnd: 8 }, 21), { book: 45, chapter: 5, verseStart: 8 });
	assert.deepEqual(normalizePassage({ book: 45, chapter: 5, verseStart: 1, verseEnd: 99 }, 21), { book: 45, chapter: 5, verseStart: 1, verseEnd: 21 });
	for (const bad of [
		{ book: 45, chapter: 5, verseStart: 22 },
		{ book: 45, chapter: 5, verseStart: 9, verseEnd: 3 },
		{ book: 0, chapter: 1 },
		{ book: 67, chapter: 1 },
		{ book: 45, chapter: 0 },
		{ book: 45, chapter: 5, verseEnd: 3 },
	]) assert.equal(normalizePassage(bad, 21), null, JSON.stringify(bad));
	assert.equal(passageLabel("Romans", { book: 45, chapter: 5 }), "Romans 5");
	assert.equal(passageLabel("Romans", { book: 45, chapter: 5, verseStart: 1, verseEnd: 11 }), "Romans 5:1-11");
	assert.equal(readerHref({ book: 45, chapter: 5, verseStart: 8 }), "/bible/chapter?book=45&chapter=5&verse=8&translation=KJV");
	assert.deepEqual(passageVerseNumbers({ book: 45, chapter: 5, verseStart: 3, verseEnd: 5 }, 21), { verses: [3, 4, 5], truncated: false });
	const psalm119 = passageVerseNumbers({ book: 19, chapter: 119 }, 176);
	assert.equal(psalm119.verses.length, PASSAGE_VERSES_SHOWN_MAX);
	assert.equal(psalm119.truncated, true);
	assert.deepEqual(storedPassage({ passage: { book: 45, chapter: 5, verseStart: 1 } }), { book: 45, chapter: 5, verseStart: 1 });
	assert.equal(storedPassage({ passage: { book: "45", chapter: 5 } }), null);
	assert.equal(storedPassage({}), null);
});

test("each kind of post asks only for what it needs", () => {
	assert.deepEqual(checkPostInput({ kind: "question", body: " What does peace with God mean? " }).value, {
		kind: "question", body: "What does peace with God mean?", title: null, reference: null, parentId: null, noteId: null,
	});
	assert.equal(checkPostInput({ kind: "passage", reference: "Romans 5:1-11" }).ok, true, "a passage may come without a comment");
	assert.equal(checkPostInput({ kind: "passage", body: "read this" }).ok, false, "but never without a passage");
	assert.equal(checkPostInput({ kind: "question", body: " " }).ok, false);
	assert.equal(checkPostInput({ kind: "question", body: "x".repeat(QUESTION_MAX + 1) }).ok, false);
	assert.equal(checkPostInput({ kind: "note", title: "Grace", body: "x".repeat(NOTE_MAX) }).ok, true);
	assert.equal(checkPostInput({ kind: "note", body: "" }).ok, false);
	assert.equal(checkPostInput({ kind: "reply", body: "Amen" }).ok, false, "a reply needs its parent");
	assert.equal(checkPostInput({ kind: "question", body: "Why?", parentId: "abc" }).ok, false, "only a reply has a parent");
	assert.equal(checkPostInput({ kind: "reply", body: "Amen", parentId: "abc", reference: "John 1" }).ok, false);
	assert.equal(checkPostInput({ kind: "question", body: "Why?", title: "T" }).ok, false, "only a note has a title");
	assert.equal(checkPostInput({ kind: "note", noteId: "note_1" }).ok, true);
	assert.equal(checkPostInput({ kind: "note", noteId: "note_1", body: "edited on the way in" }).ok, false, "a shared note is copied as it is");
	assert.equal(checkPostInput({ kind: "question", body: "Why?", noteId: "note_1" }).ok, false);
	assert.equal(checkPostInput({ kind: "note", noteId: "../x" }).ok, false);
	assert.equal(checkPostInput({ kind: "prayer", body: "x" }).ok, false, "there is no prayer kind: prayers are never posted into a room");
});

test("PRIVACY: only its owner can share a note, and only a copy of its title and text goes in", () => {
	const note = { userId: ALICE, title: "  My private  thoughts ", plainText: "Lord, I struggle with anger.\r\n\r\n\r\nHelp me.", content: "{tiptap}", folderId: "f1", tags: ["prayer"] };
	assert.equal(snapshotSharedNote(note, BOB), null, "Bob holding Alice's note id copies nothing");
	assert.equal(snapshotSharedNote(note, ""), null);
	const copy = snapshotSharedNote(note, ALICE);
	assert.deepEqual(copy, { title: "My private thoughts", body: "Lord, I struggle with anger.\n\nHelp me." });
	assert.deepEqual(Object.keys(copy).sort(), ["body", "title"], "no id, folder, tags or editor state");
	assert.equal(snapshotSharedNote({ userId: ALICE, title: "Empty", plainText: "   " }, ALICE), null);
	const long = snapshotSharedNote({ userId: ALICE, title: "", plainText: "x".repeat(NOTE_MAX + 50) }, ALICE);
	assert.equal(long.body.length, NOTE_MAX);
	assert.ok(long.body.endsWith("…"), "a clipped copy says so");
	assert.equal(long.title, "Untitled note");
});

test("PRIVACY: a member's view of another member carries no account id and no reading history", () => {
	const row = { id: "m_bob", userId: BOB, role: "member", displayName: "Bob", joinedAt: new Date("2026-10-26T12:00:00Z"), planId: "plan_bob", email: "bob@example.com" };
	const plan = {
		id: "plan_bob", presetKey: "gospels-30", title: "The Gospels in 30 days", currentDay: 4, completedCount: 3, dayCount: 30, percent: 10, streak: 2,
		days: [{ day: 1, readings: [{ book: "Matthew", chapter: 1 }], focus: "x", done: true, doneSource: "read" }],
	};
	const view = memberView(row, owner, progressView(row.planId, plan, "gospels-30"));
	assert.deepEqual(Object.keys(view).sort(), ["action", "displayName", "id", "isYou", "joinedAt", "plan", "role"]);
	assert.deepEqual(view.plan, { following: true, currentDay: 4, completedCount: 3, dayCount: 30, percent: 10 });
	const json = JSON.stringify(view);
	for (const secret of [BOB, "plan_bob", "Matthew", "streak", "bob@example.com", "doneSource"]) assert.equal(json.includes(secret), false, `leaked ${secret}`);
	assert.equal(view.action, "remove");
	assert.equal(memberView(row, member, { following: false }).isYou, true);
});

test("PRIVACY: progress shows only while the member's active plan is still the one they started from the room", () => {
	const active = { id: "p1", presetKey: "psalms-proverbs-31", currentDay: 2, completedCount: 1, dayCount: 31, percent: 3 };
	assert.equal(progressView(null, active, "psalms-proverbs-31").following, false, "a member who never followed shares nothing");
	assert.equal(progressView("p1", null, "psalms-proverbs-31").following, false);
	assert.deepEqual(progressView("p_old", active, "psalms-proverbs-31"), { following: false }, "a member who moved to another plan of their own shares nothing about it");
	assert.equal(progressView("p1", active, "gospels-30").following, false, "a follow that raced the owner's change of plan shows nothing");
	assert.equal(progressView("p1", active, null).following, false, "nor once the plan is taken down");
	assert.equal(progressView("p1", active, "psalms-proverbs-31").following, true);
});

test("PRIVACY: a post shows its author's room name, never their account, and nothing of its stored data but the shared-note mark", () => {
	const row = { id: "post1", kind: "note", authorId: ALICE, parentId: null, title: "Grace", body: "Shared text", data: { sharedNote: true, noteId: "note_secret", passage: { book: 45, chapter: 5 } }, refs: ["45.5"], createdAt: new Date("2026-10-26T12:00:00Z") };
	const view = postView(row, { id: "m_alice", displayName: "Alice", role: "owner" }, member, null);
	const json = JSON.stringify(view);
	for (const secret of [ALICE, "note_secret", "authorId"]) assert.equal(json.includes(secret), false, `leaked ${secret}`);
	assert.equal(view.sharedNote, true);
	assert.deepEqual(view.author, { memberId: "m_alice", displayName: "Alice", isYou: false, isOwner: true }, "names are chosen, so the owner's posts say who the owner is");
	assert.equal(view.canDelete, false, "a member cannot remove someone else's post");
	assert.equal(postView(row, { id: "m_alice", displayName: "Alice", role: "owner" }, owner, null).canDelete, true);
	assert.equal(postView(row, { id: "m_alice", displayName: "Alice", role: "leader" }, owner, null).author.isOwner, false, "a role rooms does not know grants nothing");
});

test("threads read down: questions newest first, replies oldest first, orphans dropped", () => {
	const base = { title: null, body: "b", sharedNote: false, passage: null, author: { memberId: "m", displayName: "A", isYou: false, isOwner: false }, canDelete: false, replies: [] };
	const posts = [
		{ ...base, id: "q1", kind: "question", parentId: null, createdAt: "2026-10-26T10:00:00.000Z" },
		{ ...base, id: "q2", kind: "question", parentId: null, createdAt: "2026-10-26T11:00:00.000Z" },
		{ ...base, id: "r2", kind: "reply", parentId: "q1", createdAt: "2026-10-26T12:30:00.000Z" },
		{ ...base, id: "r1", kind: "reply", parentId: "q1", createdAt: "2026-10-26T12:00:00.000Z" },
		{ ...base, id: "orphan", kind: "reply", parentId: "gone", createdAt: "2026-10-26T12:00:00.000Z" },
	];
	const threads = threadPosts(posts);
	assert.deepEqual(threads.map((post) => post.id), ["q2", "q1"]);
	assert.deepEqual(threads[1].replies.map((post) => post.id), ["r1", "r2"]);
	assert.equal(JSON.stringify(threads).includes("orphan"), false);
	assert.equal("parentId" in threads[0], false);
});

test("who may do what: the owner removes and moderates, members leave and remove their own", () => {
	assert.equal(memberAction(owner, { userId: BOB, role: "member" }), "remove");
	assert.equal(memberAction(owner, owner), null, "the owner archives rather than leaving");
	assert.equal(memberAction(member, member), "leave");
	assert.equal(memberAction(member, owner), null);
	assert.equal(memberAction(member, { userId: "user_carol", role: "member" }), null);
	assert.equal(canDeletePost({ authorId: BOB }, member), true);
	assert.equal(canDeletePost({ authorId: ALICE }, member), false);
	assert.equal(canDeletePost({ authorId: BOB }, owner), true);
	assert.equal(initialsOf("Mary Proof"), "MP");
	assert.equal(initialsOf(" jay "), "J");
	assert.equal(initialsOf(""), "?");
});

test("rooms leave space for Together's products: a purpose per room, a module per post", () => {
	assert.equal(ROOMS_MODULE, "rooms");
	const rooms = read("src/lib/beta/rooms/rooms.ts");
	assert.match(rooms, /createRoom\(userId: string, input: unknown, purpose: RoomPurpose = "study"\)/);
	assert.match(rooms, /where: \{ userId, room: \{ purpose \} \}/, "Study Rooms lists only study rooms");
	assert.match(rooms, /module: ROOMS_MODULE,\n\t\t\tkind: post\.kind/, "Study Rooms writes its own posts under its own module");
	assert.match(rooms, /findMany\(\{ where: \{ roomId, module: ROOMS_MODULE \}/, "and shows only its own, so another module's kinds never render as rooms posts");
	const schema = read("prisma/schema.prisma");
	assert.match(schema, /purpose +String +@default\("study"\)/);
	assert.match(schema, /module +String +@default\("rooms"\)/);
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

test("PRIVACY (server): rooms read no private model except the owner's own note being shared", () => {
	const source = read("src/lib/beta/rooms/rooms.ts");
	const models = new Set([...source.matchAll(/\bprisma\.(\$?\w+)\./g)].map((match) => match[1]));
	models.delete("$transaction");
	assert.deepEqual([...models].sort(), ["betaRoom", "betaRoomMember", "betaRoomPost", "note"], "rooms touch their own tables, plus one note lookup");
	const noteReads = [...source.matchAll(/prisma\.note\.(\w+)\(([^)]*)\)/g)];
	assert.equal(noteReads.length, 1, "exactly one read of Note");
	assert.equal(noteReads[0][1], "findFirst");
	assert.match(noteReads[0][2], /where: \{ id: post\.noteId, userId \}/, "scoped to the caller, so a foreign note id finds nothing");
	assert.match(source, /snapshotSharedNote\(note, userId\)/);
	for (const name of ["conversation", "message", "userMemory", "readingEvent", "readingLog", "verseHighlight", "noteAIMessage", "prayer"]) {
		assert.equal(new RegExp(`prisma\\.${name}`, "i").test(source), false, `rooms must never read ${name}`);
	}
	// What one member sees of another goes through the allowlists, never a raw row.
	assert.match(source, /memberView\(member, viewer,/);
	assert.match(source, /postView\(post, author, viewer, passage\)/);
	assert.match(source, /progressView\(member\.planId, active, room\.planPresetKey\)/);
	assert.equal(/\.\.\.member\b|\.\.\.me\b|\.\.\.room\b/.test(source), false, "no row is spread into a view");
});

test("every rooms route is gated, acts as the session's founder, and never touches Prisma itself", () => {
	const routes = routeFiles("src/app/api/beta/rooms");
	assert.equal(routes.length, 8);
	for (const route of routes) {
		const source = read(route);
		const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\b/g)].length;
		assert.ok(handlers >= 1, `${route} has no handlers`);
		const gated = [...source.matchAll(/const gate = await requireBetaApi\(\);\n\tif \(!gate\.ok\) return gate\.response;/g)].length;
		const delegated = /return change\(params, (true|false)\)/.test(source) ? 0 : handlers;
		assert.ok(gated >= delegated && gated >= 1, `${route}: every handler starts with the beta gate`);
		assert.equal(/prisma/.test(source), false, `${route} must go through src/lib/beta/rooms/rooms.ts`);
		assert.equal(/userId\s*[:=]\s*(body|json|req)/.test(source), false, `${route} must not take a user id from the request`);
	}
});

test("account deletion takes rooms, memberships and posts with the account", () => {
	const deletion = read("src/lib/account-deletion.ts");
	for (const model of ["BetaRoom", "BetaRoomMember", "BetaRoomPost"]) assert.match(deletion, new RegExp(`\\{ model: "${model}", via: "cascade" \\}`));
	const schema = read("prisma/schema.prisma");
	const block = schema.slice(schema.indexOf("// Beta module: rooms"));
	assert.match(block, /owner +User +@relation\(fields: \[ownerId\], references: \[id\], onDelete: Cascade\)/);
	assert.match(block, /user +User +@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
	assert.match(block, /author +User +@relation\(fields: \[authorId\], references: \[id\], onDelete: Cascade\)/);
	assert.match(block, /parent +BetaRoomPost\? +@relation\("BetaRoomThread", fields: \[parentId\], references: \[id\], onDelete: Cascade\)/);
	assert.match(read("docs/FEATURES.md"), /\| BetaRoom, BetaRoomMember, BetaRoomPost /);
	const rooms = read("src/lib/beta/rooms/rooms.ts");
	assert.match(rooms, /prisma\.betaRoomPost\.deleteMany\(\{ where: \{ roomId, authorId: target\.userId \} \}\),\s+prisma\.betaRoomMember\.deleteMany/, "leaving or removal deletes that member's posts in the same transaction");
	assert.match(rooms, /action === "remove" && me\.room\.inviteToken \? \[prisma\.betaRoom\.update\(\{ where: \{ id: roomId \}, data: \{ inviteToken: mintInviteToken\(\) \} \}\)\]/, "and removal replaces a live invite link, so the removed member cannot rejoin with it");
});

test("the migration holds only the rooms statements", () => {
	const dir = readdirSync(join(repoRoot, "prisma/migrations")).find((name) => name.endsWith("_beta_rooms"));
	assert.ok(dir, "migration folder");
	const sql = read(`prisma/migrations/${dir}/migration.sql`);
	assert.match(sql, /SET lock_timeout = '5s';/);
	for (const statement of sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) {
		if (statement.startsWith("SET lock_timeout")) continue;
		assert.match(statement, /"BetaRoom(Member|Post)?"/, `unexpected statement: ${statement.slice(0, 80)}`);
		assert.equal(/\bDROP\b/i.test(statement), false, "never drops anything");
	}
});
