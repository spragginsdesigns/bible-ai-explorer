/**
 * Pure rules for Study Rooms (LC-17647, docs/beta/rooms.md): what a room, a
 * member and a post may hold, who may do what, and exactly which fields one
 * member can ever see of another.
 *
 * The privacy contract lives here. A room only ever holds what its members
 * typed into it or chose to share into it; a shared note is a copy made by
 * `snapshotSharedNote`, which refuses anyone else's note. And the views below
 * are allowlists: a member's Clerk id, their reading plan's days and their
 * private plan id never reach another member, whatever the rows carry.
 *
 * No imports on purpose: tests/beta-rooms.test.mjs loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

export const ROOM_NAME_MAX = 80;
export const ROOM_DESCRIPTION_MAX = 300;
export const DISPLAY_NAME_MAX = 40;
/** A family, a small group or a class. Past this it is a congregation. */
export const ROOM_MEMBERS_MAX = 30;
/** Open (unarchived) rooms one person may own. */
export const ROOMS_OWNED_MAX = 20;
export const ROOM_POSTS_MAX = 1000;
export const QUESTION_MAX = 600;
export const REPLY_MAX = 2000;
export const PASSAGE_COMMENT_MAX = 1000;
export const NOTE_TITLE_MAX = 120;
export const NOTE_MAX = 8000;
/** Verses a shared passage shows in the room; the reader has the rest. */
export const PASSAGE_VERSES_SHOWN_MAX = 40;

/**
 * What a room is for. Study Rooms makes "study" rooms; Together's products
 * (docs/beta/expansion.md) make and list their own through the same tables.
 */
export type RoomPurpose = "study" | "family" | "group" | "church";

/** The `module` Study Rooms' own posts are written under; another module keeps its own kinds under its slug. */
export const ROOMS_MODULE = "rooms";

/**
 * Where each purpose's rooms live: Study Rooms here, and Together's products
 * at their own registry paths, so an invite link opens the product it belongs
 * to and each product's routes see only its own rooms.
 */
export const ROOM_PURPOSE_PATHS: Readonly<Record<RoomPurpose, { page: string; api: string }>> = {
	study: { page: "/beta/study/rooms", api: "/api/beta/rooms" },
	group: { page: "/beta/together/groups", api: "/api/beta/groups" },
	family: { page: "/beta/together/family", api: "/api/beta/family" },
	church: { page: "/beta/together/churches", api: "/api/beta/churches" },
};

/**
 * "owner" | "leader" | "member". Study Rooms makes owners and members only;
 * SureWord Groups (LC-17656) names leaders, who may remove members but never
 * the owner or another leader. A role this module does not know (a family's
 * "parent", added by the module that needs it) counts as a member here.
 */
export type RoomRole = "owner" | "leader" | "member";
/** The roles an owner can give a member; ownership never moves. */
export const ASSIGNABLE_ROOM_ROLES: readonly RoomRole[] = ["leader", "member"];
export type RoomPostKind = "passage" | "question" | "note" | "reply";
export const ROOM_POST_KINDS: readonly RoomPostKind[] = ["passage", "question", "note", "reply"];

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/**
 * The invite link's slug is the capability, minted like SharedAnswer's id: 12
 * random bytes, 16 base64url characters. Checked before any query, so a
 * hand-typed path is a 404 without touching the database.
 */
export function isRoomInviteToken(value: unknown): value is string {
	return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}

export function roomInvitePath(token: string, purpose: RoomPurpose = "study"): string {
	return `${ROOM_PURPOSE_PATHS[purpose].page}/join/${token}`;
}

/** One line: trimmed, inner whitespace collapsed. Null when empty or too long. */
export function cleanLine(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.replace(/\s+/g, " ").trim();
	return text && text.length <= max ? text : null;
}

/**
 * Prose: trimmed, line endings unified, trailing spaces and runs of blank
 * lines removed, paragraphs kept. Null when empty or too long.
 */
export function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text && text.length <= max ? text : null;
}

export interface RoomInput {
	name: string;
	description: string | null;
	displayName: string;
}

export function checkRoomInput(input: unknown): Checked<RoomInput> {
	const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
	const name = cleanLine(raw.name, ROOM_NAME_MAX);
	if (!name) return { ok: false, error: `Give the room a name of up to ${ROOM_NAME_MAX} characters.` };
	const description = raw.description === undefined || raw.description === null || raw.description === "" ? null : cleanText(raw.description, ROOM_DESCRIPTION_MAX);
	if (description === null && typeof raw.description === "string" && raw.description.trim()) {
		return { ok: false, error: `Keep the description under ${ROOM_DESCRIPTION_MAX} characters.` };
	}
	const displayName = checkDisplayName(raw.displayName);
	if (!displayName.ok) return displayName;
	return { ok: true, value: { name, description, displayName: displayName.value } };
}

export function checkDisplayName(value: unknown): Checked<string> {
	const name = cleanLine(value, DISPLAY_NAME_MAX);
	return name ? { ok: true, value: name } : { ok: false, error: `Say what the room should call you, up to ${DISPLAY_NAME_MAX} characters.` };
}

export interface RoomPatch {
	name?: string;
	description?: string | null;
	archived?: boolean;
	/** A reading-plan preset key, or null to take the plan down. */
	planPresetKey?: string | null;
}

export function checkRoomPatch(input: unknown, presetKeys: readonly string[]): Checked<RoomPatch> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Send the fields to change." };
	const raw = input as Record<string, unknown>;
	const patch: RoomPatch = {};
	if (raw.name !== undefined) {
		const name = cleanLine(raw.name, ROOM_NAME_MAX);
		if (!name) return { ok: false, error: `Give the room a name of up to ${ROOM_NAME_MAX} characters.` };
		patch.name = name;
	}
	if (raw.description !== undefined) {
		if (raw.description === null || (typeof raw.description === "string" && !raw.description.trim())) patch.description = null;
		else {
			const description = cleanText(raw.description, ROOM_DESCRIPTION_MAX);
			if (!description) return { ok: false, error: `Keep the description under ${ROOM_DESCRIPTION_MAX} characters.` };
			patch.description = description;
		}
	}
	if (raw.archived !== undefined) {
		if (typeof raw.archived !== "boolean") return { ok: false, error: "archived must be true or false." };
		patch.archived = raw.archived;
	}
	if (raw.planPresetKey !== undefined) {
		if (raw.planPresetKey !== null && (typeof raw.planPresetKey !== "string" || !presetKeys.includes(raw.planPresetKey))) {
			return { ok: false, error: "That is not one of the reading plans." };
		}
		patch.planPresetKey = raw.planPresetKey;
	}
	if (Object.keys(patch).length === 0) return { ok: false, error: "Send the fields to change." };
	return { ok: true, value: patch };
}

/** A passage inside one chapter: the whole chapter, one verse, or a range. */
export interface RoomPassage {
	/** Canonical book order, 1-66. */
	book: number;
	chapter: number;
	verseStart?: number;
	verseEnd?: number;
}

/**
 * Check a parsed passage against the real chapter length. A range that runs
 * past the chapter is clamped to its last verse (Romans 5:1-30 is Romans
 * 5:1-21); a start past the end, or an end before the start, is no passage.
 */
export function normalizePassage(passage: RoomPassage, versesInChapter: number): RoomPassage | null {
	const { book, chapter, verseStart, verseEnd } = passage;
	if (!Number.isInteger(book) || book < 1 || book > 66) return null;
	if (!Number.isInteger(chapter) || chapter < 1) return null;
	if (!Number.isInteger(versesInChapter) || versesInChapter < 1) return null;
	if (verseStart === undefined) return verseEnd === undefined ? { book, chapter } : null;
	if (!Number.isInteger(verseStart) || verseStart < 1 || verseStart > versesInChapter) return null;
	if (verseEnd === undefined || verseEnd === verseStart) return { book, chapter, verseStart };
	if (!Number.isInteger(verseEnd) || verseEnd < verseStart) return null;
	return { book, chapter, verseStart, verseEnd: Math.min(verseEnd, versesInChapter) };
}

/** Read back from a post's stored `data`, or null when it holds no valid passage. */
export function storedPassage(data: unknown): RoomPassage | null {
	if (typeof data !== "object" || data === null) return null;
	const passage = (data as { passage?: unknown }).passage;
	if (typeof passage !== "object" || passage === null) return null;
	const p = passage as Record<string, unknown>;
	const ints = [p.book, p.chapter, p.verseStart, p.verseEnd].every((v) => v === undefined || Number.isInteger(v));
	if (!ints || p.book === undefined || p.chapter === undefined) return null;
	return normalizePassage({ book: p.book as number, chapter: p.chapter as number, verseStart: p.verseStart as number | undefined, verseEnd: p.verseEnd as number | undefined }, Number.MAX_SAFE_INTEGER);
}

/** "Romans 5", "Romans 5:1", "Romans 5:1-11". */
export function passageLabel(bookName: string, passage: RoomPassage): string {
	const { chapter, verseStart, verseEnd } = passage;
	if (verseStart === undefined) return `${bookName} ${chapter}`;
	return verseEnd === undefined ? `${bookName} ${chapter}:${verseStart}` : `${bookName} ${chapter}:${verseStart}-${verseEnd}`;
}

/** The verse numbers a passage shows in the room, capped. */
export function passageVerseNumbers(passage: RoomPassage, versesInChapter: number): { verses: number[]; truncated: boolean } {
	const start = passage.verseStart ?? 1;
	const end = passage.verseEnd ?? (passage.verseStart === undefined ? versesInChapter : passage.verseStart);
	const last = Math.min(end, versesInChapter, start + PASSAGE_VERSES_SHOWN_MAX - 1);
	const verses: number[] = [];
	for (let verse = start; verse <= last; verse++) verses.push(verse);
	return { verses, truncated: last < Math.min(end, versesInChapter) };
}

export function readerHref(passage: RoomPassage): string {
	return `/bible/chapter?book=${passage.book}&chapter=${passage.chapter}&verse=${passage.verseStart ?? 1}&translation=KJV`;
}

export interface PostInput {
	kind: RoomPostKind;
	/** The typed text; for a passage, why it is being shared (may be empty). */
	body: string;
	title: string | null;
	/** The reference as typed ("Romans 5:1-11"), parsed by the server. */
	reference: string | null;
	parentId: string | null;
	/** One of the caller's own notes to copy in (kind "note" only). */
	noteId: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isRoomId(value: unknown): value is string {
	return typeof value === "string" && ID_PATTERN.test(value);
}

/** Shape and length checks; the server then resolves the reference, parent and note. */
export function checkPostInput(input: unknown): Checked<PostInput> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Send a post." };
	const raw = input as Record<string, unknown>;
	const kind = raw.kind;
	if (typeof kind !== "string" || !(ROOM_POST_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "kind must be passage, question, note or reply." };
	const reference = raw.reference === undefined || raw.reference === null || raw.reference === "" ? null : cleanLine(raw.reference, 60);
	if (reference === null && typeof raw.reference === "string" && raw.reference.trim()) return { ok: false, error: "That passage reference is too long." };
	const parentId = raw.parentId === undefined || raw.parentId === null ? null : isRoomId(raw.parentId) ? raw.parentId : undefined;
	if (parentId === undefined) return { ok: false, error: "Unknown post to reply to." };
	const noteId = raw.noteId === undefined || raw.noteId === null ? null : isRoomId(raw.noteId) ? raw.noteId : undefined;
	if (noteId === undefined) return { ok: false, error: "Unknown note." };
	if ((kind === "reply") !== (parentId !== null)) return { ok: false, error: kind === "reply" ? "A reply needs the post it answers." : "Only a reply answers another post." };
	if (noteId !== null && kind !== "note") return { ok: false, error: "Only a note can be shared from your notes." };

	const blank = raw.body === undefined || raw.body === null || (typeof raw.body === "string" && !raw.body.trim());
	const max = kind === "question" ? QUESTION_MAX : kind === "reply" ? REPLY_MAX : kind === "passage" ? PASSAGE_COMMENT_MAX : NOTE_MAX;
	const body = blank ? "" : cleanText(raw.body, max);
	if (body === null) return { ok: false, error: `Keep it under ${max.toLocaleString("en-US")} characters.` };

	const title = raw.title === undefined || raw.title === null || raw.title === "" ? null : cleanLine(raw.title, NOTE_TITLE_MAX);
	if (title === null && typeof raw.title === "string" && raw.title.trim()) return { ok: false, error: `Keep the title under ${NOTE_TITLE_MAX} characters.` };
	if (title !== null && kind !== "note") return { ok: false, error: "Only a note has a title." };

	if (kind === "passage" && !reference) return { ok: false, error: "Which passage? For example Romans 5:1-11." };
	if (kind === "reply" && reference) return { ok: false, error: "A reply does not take a passage." };
	if ((kind === "question" || kind === "reply") && !body) return { ok: false, error: kind === "question" ? "Write the question." : "Write a reply." };
	if (kind === "note" && noteId === null && !body) return { ok: false, error: "Write the note, or share one of yours." };
	if (kind === "note" && noteId !== null && (body || title)) return { ok: false, error: "A shared note is copied as it is." };
	return { ok: true, value: { kind: kind as RoomPostKind, body, title, reference, parentId, noteId } };
}

/**
 * The one way a private note enters a room: its owner shares it, and a copy
 * of its title and text is made. Anyone else's note is refused, so a stolen
 * or guessed note id copies nothing. Later edits to the note never reach the
 * room, and deleting the note leaves the shared copy until its author deletes
 * that too.
 */
export function snapshotSharedNote(
	note: { userId: string; title: string | null; plainText: string | null },
	callerId: string,
): { title: string; body: string } | null {
	if (!callerId || note.userId !== callerId) return null;
	const title = (note.title ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_TITLE_MAX) || "Untitled note";
	const text = (note.plainText ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	if (!text) return null;
	return { title, body: text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1).trimEnd()}…` : text };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function canDeletePost(post: { authorId: string }, viewer: { userId: string; role: RoomRole }): boolean {
	return post.authorId === viewer.userId || viewer.role === "owner";
}

/**
 * What the viewer may do to a member: remove them (the owner, anyone but
 * themself; a leader, an ordinary member), leave (anyone but the owner,
 * themself), or nothing.
 */
export function memberAction(viewer: { userId: string; role: RoomRole }, target: { userId: string; role: RoomRole }): "remove" | "leave" | null {
	if (viewer.userId === target.userId) return viewer.role === "owner" ? null : "leave";
	if (viewer.role === "owner") return target.role !== "owner" ? "remove" : null;
	return viewer.role === "leader" && target.role === "member" ? "remove" : null;
}

export function asRole(value: string): RoomRole {
	return value === "owner" ? "owner" : value === "leader" ? "leader" : "member";
}

/** A role the owner may give a member, or null. */
export function checkAssignableRole(value: unknown): RoomRole | null {
	return typeof value === "string" && (ASSIGNABLE_ROOM_ROLES as readonly string[]).includes(value) ? (value as RoomRole) : null;
}

// ---------------------------------------------------------------------------
// Views: allowlists of what a member may see
// ---------------------------------------------------------------------------

export interface MemberProgressView {
	following: boolean;
	currentDay?: number;
	completedCount?: number;
	dayCount?: number;
	percent?: number;
}

/**
 * Where a member is in the room's plan, from their own ReadingPlan, and only
 * while that plan is still the one they started from the room and the room is
 * still reading that preset. Their days, chapters, streak and reading history
 * never leave this function.
 */
export function progressView(
	memberPlanId: string | null,
	activePlan: { id: string; presetKey: string | null; currentDay: number; completedCount: number; dayCount: number; percent: number } | null,
	roomPresetKey: string | null,
): MemberProgressView {
	if (!memberPlanId || !activePlan || activePlan.id !== memberPlanId) return { following: false };
	if (!roomPresetKey || activePlan.presetKey !== roomPresetKey) return { following: false };
	return {
		following: true,
		currentDay: activePlan.currentDay,
		completedCount: activePlan.completedCount,
		dayCount: activePlan.dayCount,
		percent: activePlan.percent,
	};
}

export interface MemberView {
	id: string;
	displayName: string;
	role: RoomRole;
	isYou: boolean;
	joinedAt: string;
	plan: MemberProgressView;
	/** What the viewer may do to this member. */
	action: "remove" | "leave" | null;
}

export function memberView(
	row: { id: string; userId: string; role: string; displayName: string; joinedAt: Date | string },
	viewer: { userId: string; role: RoomRole },
	plan: MemberProgressView,
): MemberView {
	const role = asRole(row.role);
	return {
		id: row.id,
		displayName: row.displayName,
		role,
		isYou: row.userId === viewer.userId,
		joinedAt: new Date(row.joinedAt).toISOString(),
		plan,
		action: memberAction(viewer, { userId: row.userId, role }),
	};
}

export interface PassageView {
	reference: string;
	href: string;
	verses: { verse: number; text: string }[];
	truncated: boolean;
}

export interface PostView {
	id: string;
	kind: RoomPostKind;
	title: string | null;
	body: string;
	/** A shared note's copy, as opposed to one typed into the room. */
	sharedNote: boolean;
	passage: PassageView | null;
	author: { memberId: string; displayName: string; isYou: boolean; isOwner: boolean };
	createdAt: string;
	canDelete: boolean;
	replies: PostView[];
}

export function postView(
	row: { id: string; kind: string; authorId: string; title: string | null; body: string; data: unknown; createdAt: Date | string },
	author: { id: string; displayName: string; role: string },
	viewer: { userId: string; role: RoomRole },
	passage: PassageView | null,
): PostView {
	const data = typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>) : {};
	return {
		id: row.id,
		kind: (ROOM_POST_KINDS as readonly string[]).includes(row.kind) ? (row.kind as RoomPostKind) : "note",
		title: row.title,
		body: row.body,
		sharedNote: data.sharedNote === true,
		passage,
		// Names are chosen, not verified, so the owner's posts say who the owner is.
		author: { memberId: author.id, displayName: author.displayName, isYou: row.authorId === viewer.userId, isOwner: asRole(author.role) === "owner" },
		createdAt: new Date(row.createdAt).toISOString(),
		canDelete: canDeletePost(row, viewer),
		replies: [],
	};
}

/**
 * Top-level posts newest first, each with its replies oldest first (a
 * conversation reads down). A reply whose parent is gone is dropped.
 */
export function threadPosts(posts: readonly (PostView & { parentId: string | null })[]): PostView[] {
	const top = new Map<string, PostView>();
	for (const post of posts) if (post.parentId === null) top.set(post.id, { ...post, replies: [] });
	const replies = posts.filter((post) => post.parentId !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	for (const reply of replies) {
		const parent = top.get(reply.parentId as string);
		if (parent) parent.replies.push(stripParent(reply));
	}
	return [...top.values()].map(stripParent).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function stripParent<T extends PostView & { parentId?: string | null }>(post: T): PostView {
	const { parentId: _parentId, ...rest } = post;
	void _parentId;
	return rest;
}

/** Up to two initials for a member's avatar: "Mary Proof" -> "MP", "jay" -> "J". */
export function initialsOf(displayName: string): string {
	const words = displayName.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => [...word][0]?.toUpperCase() ?? "").join("") || "?";
}
