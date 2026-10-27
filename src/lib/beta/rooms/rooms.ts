import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BOOKS, bookByOrder, resolveReference } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { READING_PLAN_PRESETS, buildPresetPlan, describeReadings, type ReadingPlanPresetSummary } from "@/lib/reading-plan-presets";
import { planDayIndex } from "@/lib/reading-plan-progress";
import { ReadingPlanError, getActivePlan, startPlan } from "@/lib/reading-plans";
import {
	ROOMS_MODULE,
	ROOM_MEMBERS_MAX,
	ROOM_POSTS_MAX,
	ROOMS_OWNED_MAX,
	asRole,
	checkDisplayName,
	checkPostInput,
	checkRoomInput,
	checkRoomPatch,
	isRoomId,
	isRoomInviteToken,
	memberAction,
	memberView,
	normalizePassage,
	passageLabel,
	passageVerseNumbers,
	postView,
	progressView,
	readerHref,
	snapshotSharedNote,
	storedPassage,
	threadPosts,
	canDeletePost,
	type MemberProgressView,
	type MemberView,
	type PassageView,
	type PostView,
	type RoomPassage,
	type RoomPurpose,
	type RoomRole,
} from "@/lib/beta/rooms/rooms-rules";

/**
 * Study Rooms (LC-17647, docs/beta/rooms.md): shared Bible studies for a
 * family, small group or class.
 *
 * Every read and write starts from the caller's membership: a room they are
 * not in, or an id that does not exist, is the same 404. What a member sees
 * of the others goes through the allowlist views in rooms-rules.ts. The only
 * private data this module ever reads is (a) a note its owner is sharing,
 * looked up by that owner's id, and (b) a following member's reading-plan day
 * count, through getActivePlan, reduced to five numbers by progressView.
 */

export class RoomError extends Error {
	readonly status: 400 | 403 | 404 | 409;
	readonly detail?: Record<string, unknown>;
	constructor(message: string, status: 400 | 403 | 404 | 409 = 400, detail?: Record<string, unknown>) {
		super(message);
		this.status = status;
		this.detail = detail;
	}
}

const notFound = () => new RoomError("Not found", 404);
const archivedError = () => new RoomError("This room is archived. Its owner can restore it.", 409);

/** 12 random bytes as 16 base64url characters, like SharedAnswer's id. */
function mintInviteToken(): string {
	return randomBytes(12).toString("base64url");
}

async function requireMembership(userId: string, roomId: string) {
	if (!isRoomId(roomId)) return null;
	return prisma.betaRoomMember.findUnique({ where: { roomId_userId: { roomId, userId } }, include: { room: true } });
}

async function requireOwner(userId: string, roomId: string) {
	const me = await requireMembership(userId, roomId);
	if (!me) throw notFound();
	if (asRole(me.role) !== "owner") throw new RoomError("Only the room's owner can do that.", 403);
	return me;
}

// ---------------------------------------------------------------------------
// The group reading plan
// ---------------------------------------------------------------------------

function roomPlan(room: { planPresetKey: string | null; planStartDate: Date | null }, now: Date) {
	if (!room.planPresetKey || !room.planStartDate) return null;
	const preset = buildPresetPlan(room.planPresetKey);
	if (!preset || preset.days.length === 0) return null;
	return { preset, startDate: room.planStartDate, todayDay: planDayIndex(room.planStartDate, now, preset.days.length) };
}

const BOOK_ORDER_BY_NAME = new Map(BOOKS.map((book) => [book.name, book.order]));

export interface RoomPlanView {
	presetKey: string;
	title: string;
	description: string;
	dayCount: number;
	startDate: string;
	/** Which day of the plan it is for the whole room. */
	todayDay: number;
	today: { day: number; readings: string; focus: string; href: string | null };
}

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

const RANGE_END = /:\s*\d+\s*[-–—]\s*(\d+)\s*$/;
const CROSS_CHAPTER = /:\s*\d+\s*[-–—]\s*\d+\s*:/;

/** "Romans 5", "Rom 5:1", "Romans 5:1-11", within one chapter, or a 400. */
async function parsePassage(text: string): Promise<RoomPassage> {
	if (CROSS_CHAPTER.test(text)) throw new RoomError("Share one chapter at a time, for example Romans 5:1-11.");
	const ref = resolveReference(text);
	if (!ref) throw new RoomError(`"${text}" is not a passage we recognize. Try Romans 5 or John 3:16.`);
	const verses = await getKjvChapter(ref.order, ref.chapter);
	const end = text.match(RANGE_END);
	const passage = normalizePassage(
		{ book: ref.order, chapter: ref.chapter, verseStart: ref.verse, verseEnd: end ? Number(end[1]) : undefined },
		verses.length,
	);
	if (!passage) throw new RoomError(`"${text}" is not in the KJV. Check the chapter and verses.`);
	return passage;
}

/** Verse text is read from the bundled KJV every time, never stored or typed. */
async function passageView(stored: RoomPassage, withText: boolean, chapters: Map<string, Promise<string[]>>): Promise<PassageView | null> {
	const book = bookByOrder(stored.book);
	if (!book) return null;
	const key = `${stored.book}.${stored.chapter}`;
	if (!chapters.has(key)) chapters.set(key, getKjvChapter(stored.book, stored.chapter).catch(() => []));
	const chapter = await chapters.get(key)!;
	const passage = normalizePassage(stored, chapter.length);
	if (!passage) return null;
	const shown = withText ? passageVerseNumbers(passage, chapter.length) : { verses: [], truncated: false };
	return {
		reference: passageLabel(book.name, passage),
		href: readerHref(passage),
		verses: shown.verses.map((verse) => ({ verse, text: chapter[verse - 1] })),
		truncated: shown.truncated,
	};
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface RoomSummary {
	id: string;
	name: string;
	description: string | null;
	role: RoomRole;
	memberCount: number;
	archived: boolean;
	plan: { title: string; todayDay: number; dayCount: number } | null;
	lastActivityAt: string;
}

/** Every room of one purpose the caller is in, most recently active first. */
export async function listRooms(userId: string, purpose: RoomPurpose = "study", now = new Date()): Promise<RoomSummary[]> {
	const memberships = await prisma.betaRoomMember.findMany({
		where: { userId, room: { purpose } },
		take: 200,
		include: {
			room: {
				include: {
					_count: { select: { members: true } },
					posts: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
				},
			},
		},
	});
	return memberships
		.map(({ role, room, joinedAt }) => {
			const plan = roomPlan(room, now);
			const last = [room.createdAt, joinedAt, room.posts[0]?.createdAt].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0];
			return {
				id: room.id,
				name: room.name,
				description: room.description,
				role: asRole(role),
				memberCount: room._count.members,
				archived: Boolean(room.archivedAt),
				plan: plan && { title: plan.preset.title, todayDay: plan.todayDay, dayCount: plan.preset.days.length },
				lastActivityAt: last.toISOString(),
			};
		})
		.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Creates the room with the caller as its owner and first member. */
export async function createRoom(userId: string, input: unknown, purpose: RoomPurpose = "study"): Promise<string> {
	const checked = checkRoomInput(input);
	if (!checked.ok) throw new RoomError(checked.error);
	const open = await prisma.betaRoom.count({ where: { ownerId: userId, archivedAt: null } });
	if (open >= ROOMS_OWNED_MAX) throw new RoomError(`You have ${ROOMS_OWNED_MAX} open rooms. Archive one to start another.`, 409);
	const { name, description, displayName } = checked.value;
	const room = await prisma.betaRoom.create({
		data: { ownerId: userId, purpose, name, description, members: { create: { userId, role: "owner", displayName } } },
		select: { id: true },
	});
	return room.id;
}

export interface RoomView {
	id: string;
	name: string;
	description: string | null;
	archived: boolean;
	isOwner: boolean;
	you: { memberId: string; role: RoomRole; displayName: string; following: boolean };
	/** The owner's view only: the current invite slug, or null while the link is off. */
	inviteToken?: string | null;
	members: MemberView[];
	plan: RoomPlanView | null;
	/** The owner's view only: the plans they can choose from. */
	presets?: ReadingPlanPresetSummary[];
	posts: PostView[];
}

/** The room as the caller sees it, or null when they are not in it. */
export async function getRoomView(userId: string, roomId: string, now = new Date()): Promise<RoomView | null> {
	const me = await requireMembership(userId, roomId);
	if (!me) return null;
	const room = me.room;
	const viewer = { userId, role: asRole(me.role) };
	const [members, posts] = await Promise.all([
		prisma.betaRoomMember.findMany({ where: { roomId }, orderBy: { joinedAt: "asc" }, take: ROOM_MEMBERS_MAX * 2 }),
		prisma.betaRoomPost.findMany({ where: { roomId, module: ROOMS_MODULE }, orderBy: { createdAt: "desc" }, take: ROOM_POSTS_MAX }),
	]);

	// Only members who chose to follow the room's plan have a planId; their day
	// count is read from their own plan and nothing else of it leaves here.
	const progress = new Map<string, MemberProgressView>();
	await Promise.all(
		members.map(async (member) => {
			const active = member.planId ? await getActivePlan(member.userId).catch(() => null) : null;
			progress.set(member.id, progressView(member.planId, active, room.planPresetKey));
		}),
	);

	const byUser = new Map(members.map((member) => [member.userId, member]));
	const chapters = new Map<string, Promise<string[]>>();
	const views = (
		await Promise.all(
			posts.map(async (post) => {
				// A post outlives its author only by a moment (leaving deletes it).
				const author = byUser.get(post.authorId);
				if (!author) return null;
				const stored = storedPassage(post.data);
				const passage = stored ? await passageView(stored, post.kind === "passage", chapters) : null;
				return { ...postView(post, author, viewer, passage), parentId: post.parentId };
			}),
		)
	).filter((view): view is PostView & { parentId: string | null } => view !== null);

	const plan = roomPlan(room, now);
	let planView: RoomPlanView | null = null;
	if (plan) {
		const today = plan.preset.days[plan.todayDay - 1];
		const first = today?.readings[0];
		const firstOrder = first && BOOK_ORDER_BY_NAME.get(first.book);
		planView = {
			presetKey: plan.preset.key,
			title: plan.preset.title,
			description: plan.preset.description,
			dayCount: plan.preset.days.length,
			startDate: plan.startDate.toISOString(),
			todayDay: plan.todayDay,
			today: {
				day: plan.todayDay,
				readings: today ? describeReadings(today.readings) : "",
				focus: today?.focus ?? "",
				href: firstOrder ? readerHref({ book: firstOrder, chapter: first.chapter }) : null,
			},
		};
	}

	const memberViews = members
		.map((member) => memberView(member, viewer, progress.get(member.id) ?? { following: false }))
		.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
	const isOwner = viewer.role === "owner";
	return {
		id: room.id,
		name: room.name,
		description: room.description,
		archived: Boolean(room.archivedAt),
		isOwner,
		you: { memberId: me.id, role: viewer.role, displayName: me.displayName, following: progress.get(me.id)?.following ?? false },
		...(isOwner && { inviteToken: room.inviteToken, presets: READING_PLAN_PRESETS }),
		members: memberViews,
		plan: planView,
		posts: threadPosts(views),
	};
}

/** The owner renames, describes, archives or restores the room, or sets its plan. */
export async function updateRoom(userId: string, roomId: string, input: unknown): Promise<void> {
	const me = await requireOwner(userId, roomId);
	const checked = checkRoomPatch(input, READING_PLAN_PRESETS.map((preset) => preset.key));
	if (!checked.ok) throw new RoomError(checked.error);
	const patch = checked.value;
	const room = me.room;
	const restoring = patch.archived === false && room.archivedAt !== null;
	if (room.archivedAt && !restoring) throw archivedError();
	if (restoring) {
		const open = await prisma.betaRoom.count({ where: { ownerId: userId, archivedAt: null } });
		if (open >= ROOMS_OWNED_MAX) throw new RoomError(`You have ${ROOMS_OWNED_MAX} open rooms. Archive one to restore this one.`, 409);
	}

	const data: Prisma.BetaRoomUpdateInput = {};
	if (patch.name !== undefined) data.name = patch.name;
	if (patch.description !== undefined) data.description = patch.description;
	if (patch.archived === true) {
		data.archivedAt = new Date();
		// Archiving closes the door: the invite link stops working with it.
		data.inviteToken = null;
	}
	if (restoring) data.archivedAt = null;
	// Choosing the plan already running keeps its start date and its followers.
	const planChanged = patch.planPresetKey !== undefined && patch.planPresetKey !== room.planPresetKey;
	if (planChanged) {
		data.planPresetKey = patch.planPresetKey;
		data.planStartDate = patch.planPresetKey ? new Date() : null;
	}
	await prisma.$transaction([
		prisma.betaRoom.update({ where: { id: room.id }, data }),
		// A new plan has no followers yet. Each member's own reading plan is
		// theirs and is left as it is; the room just stops reading it.
		...(planChanged ? [prisma.betaRoomMember.updateMany({ where: { roomId: room.id }, data: { planId: null } })] : []),
	]);
}

/** The owner turns the invite link on (a fresh slug every time) or off. */
export async function setInvite(userId: string, roomId: string, on: boolean): Promise<string | null> {
	const me = await requireOwner(userId, roomId);
	if (me.room.archivedAt) throw archivedError();
	const token = on ? mintInviteToken() : null;
	await prisma.betaRoom.update({ where: { id: me.room.id }, data: { inviteToken: token } });
	return token;
}

export interface InvitePreview {
	name: string;
	description: string | null;
	ownerName: string;
	memberCount: number;
	full: boolean;
	planTitle: string | null;
	/** Set when the caller is already in the room, so the page can go straight there. */
	memberOfRoomId: string | null;
}

/** What an invite link opens onto, or null once it is revoked, rotated or archived. */
export async function previewInvite(userId: string, token: string, now = new Date()): Promise<InvitePreview | null> {
	if (!isRoomInviteToken(token)) return null;
	const room = await prisma.betaRoom.findFirst({
		where: { inviteToken: token, archivedAt: null },
		include: { members: { select: { userId: true, role: true, displayName: true } } },
	});
	if (!room) return null;
	const owner = room.members.find((member) => member.role === "owner");
	const plan = roomPlan(room, now);
	return {
		name: room.name,
		description: room.description,
		ownerName: owner?.displayName ?? "The owner",
		memberCount: room.members.length,
		full: room.members.length >= ROOM_MEMBERS_MAX,
		planTitle: plan?.preset.title ?? null,
		memberOfRoomId: room.members.some((member) => member.userId === userId) ? room.id : null,
	};
}

/** Joins through a live invite link; joining twice is the same as once. */
export async function joinRoom(userId: string, token: string, input: unknown): Promise<string> {
	if (!isRoomInviteToken(token)) throw notFound();
	const name = checkDisplayName((input as { displayName?: unknown } | null)?.displayName);
	if (!name.ok) throw new RoomError(name.error);
	const room = await prisma.betaRoom.findFirst({
		where: { inviteToken: token, archivedAt: null },
		select: { id: true, _count: { select: { members: true } } },
	});
	if (!room) throw notFound();
	const existing = await prisma.betaRoomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId } }, select: { id: true } });
	if (existing) return room.id;
	if (room._count.members >= ROOM_MEMBERS_MAX) throw new RoomError(`This room is full (${ROOM_MEMBERS_MAX} people).`, 409);
	try {
		await prisma.betaRoomMember.create({ data: { roomId: room.id, userId, role: "member", displayName: name.value } });
	} catch (error) {
		if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
	}
	return room.id;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** Adds a passage, question, note or reply. Returns the new post's id. */
export async function addPost(userId: string, roomId: string, input: unknown): Promise<string> {
	const me = await requireMembership(userId, roomId);
	if (!me) throw notFound();
	if (me.room.archivedAt) throw archivedError();
	const checked = checkPostInput(input);
	if (!checked.ok) throw new RoomError(checked.error);
	const post = checked.value;
	if ((await prisma.betaRoomPost.count({ where: { roomId } })) >= ROOM_POSTS_MAX) {
		throw new RoomError(`This room holds ${ROOM_POSTS_MAX.toLocaleString("en-US")} posts. Remove some to add more.`, 409);
	}
	if (post.parentId) {
		const parent = await prisma.betaRoomPost.findFirst({ where: { id: post.parentId, roomId, module: ROOMS_MODULE, parentId: null }, select: { id: true } });
		if (!parent) throw new RoomError("That post is no longer in the room.", 409);
	}

	const passage = post.reference ? await parsePassage(post.reference) : null;
	const data: { passage?: RoomPassage; sharedNote?: true } = {};
	if (passage) data.passage = passage;
	let { title, body } = post;
	if (post.noteId) {
		// The only read of a private note: the caller's own, by their own id.
		const note = await prisma.note.findFirst({ where: { id: post.noteId, userId }, select: { userId: true, title: true, plainText: true } });
		const copy = note && snapshotSharedNote(note, userId);
		if (!copy) throw new RoomError("That note was not found, or it has no text to share.");
		title = copy.title;
		body = copy.body;
		data.sharedNote = true;
	}

	const created = await prisma.betaRoomPost.create({
		data: {
			roomId,
			authorId: userId,
			module: ROOMS_MODULE,
			kind: post.kind,
			parentId: post.parentId,
			title,
			body,
			data: data as Prisma.InputJsonObject,
		},
		select: { id: true },
	});
	return created.id;
}

/** Its author or the room's owner removes a post, and its replies with it. */
export async function deletePost(userId: string, roomId: string, postId: string): Promise<void> {
	const me = await requireMembership(userId, roomId);
	if (!me || !isRoomId(postId)) throw notFound();
	const post = await prisma.betaRoomPost.findFirst({ where: { id: postId, roomId, module: ROOMS_MODULE }, select: { authorId: true } });
	if (!post) throw notFound();
	if (!canDeletePost(post, { userId, role: asRole(me.role) })) throw new RoomError("Only its author or the room's owner can remove that.", 403);
	await prisma.betaRoomPost.deleteMany({ where: { id: postId, roomId, module: ROOMS_MODULE } });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * The owner removes a member, or a member leaves. Either way everything that
 * member posted in the room goes with them (and replies under it), in the same
 * transaction. Removal also replaces a live invite link, since the removed
 * member holds it and could otherwise walk straight back in.
 */
export async function removeMember(userId: string, roomId: string, memberId: string): Promise<"remove" | "leave"> {
	const me = await requireMembership(userId, roomId);
	if (!me || !isRoomId(memberId)) throw notFound();
	const target = await prisma.betaRoomMember.findFirst({ where: { id: memberId, roomId }, select: { id: true, userId: true, role: true } });
	if (!target) throw notFound();
	const action = memberAction({ userId, role: asRole(me.role) }, { userId: target.userId, role: asRole(target.role) });
	if (!action) {
		throw target.userId === userId
			? new RoomError("You own this room. Archive it instead of leaving.", 409)
			: new RoomError("Only the room's owner can remove members.", 403);
	}
	await prisma.$transaction([
		prisma.betaRoomPost.deleteMany({ where: { roomId, authorId: target.userId } }),
		prisma.betaRoomMember.deleteMany({ where: { id: target.id, roomId } }),
		...(action === "remove" && me.room.inviteToken ? [prisma.betaRoom.update({ where: { id: roomId }, data: { inviteToken: mintInviteToken() } })] : []),
	]);
	return action;
}

/**
 * Follow the room's plan: it becomes the caller's own ReadingPlan, from the
 * room's day 1, so the Bible reader fills it in and the room sees their day.
 * A different plan they are partway through is only replaced once they have
 * confirmed it by id (`replacePlanId`).
 */
export async function followPlan(userId: string, roomId: string, input: unknown): Promise<void> {
	const me = await requireMembership(userId, roomId);
	if (!me) throw notFound();
	if (me.room.archivedAt) throw archivedError();
	const plan = roomPlan(me.room, new Date());
	if (!plan) throw new RoomError("This room has no reading plan yet.", 409);
	const replacePlanId = (input as { replacePlanId?: unknown } | null)?.replacePlanId;
	const active = await getActivePlan(userId);
	if (active && me.planId === active.id) return;
	// Already reading this very plan from the room's day 1 (they followed, left and came back): link it, never replace it.
	if (active && active.presetKey === plan.preset.key && active.startDate === plan.startDate.toISOString()) {
		await prisma.betaRoomMember.update({ where: { id: me.id }, data: { planId: active.id } });
		return;
	}
	if (active && active.status === "active" && active.id !== replacePlanId) {
		throw new RoomError(`Following this plan replaces your reading plan, "${active.title}".`, 409, { replace: { id: active.id, title: active.title } });
	}
	try {
		const started = await startPlan(userId, { presetKey: plan.preset.key }, { expectedActiveId: active?.id ?? null, startDate: plan.startDate });
		await prisma.betaRoomMember.update({ where: { id: me.id }, data: { planId: started.id } });
	} catch (error) {
		if (error instanceof ReadingPlanError) throw new RoomError(error.message, 409);
		throw error;
	}
}

/** Stop sharing progress. The reading plan itself stays the caller's. */
export async function unfollowPlan(userId: string, roomId: string): Promise<void> {
	const me = await requireMembership(userId, roomId);
	if (!me) throw notFound();
	await prisma.betaRoomMember.update({ where: { id: me.id }, data: { planId: null } });
}
