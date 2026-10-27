import "server-only";

import { prisma } from "@/lib/prisma";
import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { buildPresetPlan, describeReadings } from "@/lib/reading-plan-presets";
import { planDayIndex } from "@/lib/reading-plan-progress";
import { createBetaItem, deleteBetaItem, getBetaItem, updateBetaItem } from "@/lib/beta/store";
import { RoomError, getRoomView, openModuleRoom, parsePassage, passageView, type ModuleMemberRow, type ModulePostRow, type ModuleRoom, type RoomView } from "@/lib/beta/rooms/rooms";
import { passageLabel, readerHref, type RoomPurpose } from "@/lib/beta/rooms/rooms-rules";
import { GroupQuestionsUnavailableError, prepareGroupQuestions } from "@/lib/beta/groups/groups-prepare";
import {
	GROUPS_MODULE,
	PRAYER_MAX,
	PREPARE_PER_WEEK_MAX,
	QUESTIONS_PER_WEEK_MAX,
	SESSION_STEPS,
	canAnswerPrayer,
	canDeleteGroupPost,
	canEditSession,
	canMarkPrayed,
	checkGroupPost,
	checkPrayerPatch,
	checkSessionPatch,
	cleanTopics,
	isLeader,
	mirrorIdOf,
	passageRefs,
	passageVerseRange,
	personView,
	planWeekOf,
	planWeeks,
	prayerView,
	questionRefs,
	questionView,
	readPrayerData,
	readQuestionData,
	readSessionData,
	readWeekData,
	replyView,
	sessionNotesText,
	sessionView,
	sortPrayers,
	type GroupPassage,
	type GroupPostKind,
	type GroupPrayerView,
	type GroupQuestionView,
	type GroupSessionView,
	type GroupViewer,
	type QuestionType,
	type VerseView,
	type WeekData,
} from "@/lib/beta/groups/groups-rules";

/**
 * SureWord Groups (LC-17656, docs/beta/groups.md): a small group or Bible
 * class, kept in a Study Room of purpose "group" (docs/beta/rooms.md).
 *
 * Membership, invites, leaders and the reading plan are Study Rooms' own
 * functions, called with this purpose. The group's weeks, questions, replies,
 * sessions and prayer circle are the room's posts under module "groups",
 * reached only through `openModuleRoom`, so every read and write starts from
 * the caller's membership and a group they are not in is the same 404 as one
 * that does not exist.
 *
 * A member's own words in the group (a question, a reply, a session's notes,
 * a prayer request) are also kept in their own study store as a `groups`
 * item with the same passage keys and topics, which is how the Knowledge
 * Vault and the Living Study Graph find them (docs/beta/README.md). That copy
 * is theirs: removing the post removes it, and leaving the group keeps it.
 *
 * The only private data read here: the caller's own prayer request being
 * shared (looked up by their id and copied), and their own AI consent.
 */

export const GROUP_PURPOSE: RoomPurpose = "group";

const notFound = () => new RoomError("Not found", 404);

async function openGroup(userId: string, groupId: string): Promise<ModuleRoom> {
	const group = await openModuleRoom(userId, groupId, GROUP_PURPOSE, GROUPS_MODULE);
	if (!group) throw notFound();
	return group;
}

function requireLeader(group: ModuleRoom): void {
	if (!isLeader(group.me.role)) throw new RoomError("Only the group's leaders can do that.", 403);
}

function viewerOf(group: ModuleRoom): GroupViewer {
	return { userId: group.me.userId, role: group.me.role };
}

/** The room's plan day today, or null without a plan. */
function planDay(room: ModuleRoom["room"], now: Date): number | null {
	if (!room.planPresetKey || !room.planStartDate) return null;
	const preset = buildPresetPlan(room.planPresetKey);
	return preset && preset.days.length ? planDayIndex(room.planStartDate, now, preset.days.length) : null;
}

/** The passage's verses from the bundled KJV, and its label. */
async function readPassage(passage: GroupPassage): Promise<{ reference: string; verses: VerseView[] }> {
	const book = bookByOrder(passage.book);
	if (!book) throw new RoomError("That passage is not in the KJV.");
	const chapter = await getKjvChapter(passage.book, passage.chapter);
	const { first, last } = passageVerseRange(passage, chapter.length);
	const verses: VerseView[] = [];
	for (let verse = first; verse <= last; verse++) verses.push({ verse, text: chapter[verse - 1] });
	return { reference: passageLabel(book.name, passage), verses };
}

function clip(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ---------------------------------------------------------------------------
// The member's own copy, in their study store
// ---------------------------------------------------------------------------

async function keepInStudy(
	userId: string,
	group: ModuleRoom,
	postId: string,
	kind: Exclude<GroupPostKind, "week" | "prayed">,
	title: string,
	body: string,
	refs: string[],
	topics: string[],
): Promise<string | null> {
	try {
		const item = await createBetaItem(userId, {
			module: GROUPS_MODULE,
			kind,
			title: clip(title, 200),
			body,
			data: { groupId: group.room.id, postId, group: group.room.name },
			refs,
			topics,
		});
		return item.id;
	} catch (error) {
		// The group post stands either way; only the Vault's copy is missing.
		console.error("[beta/groups] could not keep a copy in the study store", error);
		return null;
	}
}

/** Creates the post, then the author's own copy, and records the copy's id on the post. */
async function createWithCopy(
	userId: string,
	group: ModuleRoom,
	input: { kind: Exclude<GroupPostKind, "week" | "prayed">; parentId: string | null; body: string; data: Record<string, unknown> },
	copy: { title: string; body: string; refs: string[]; topics: string[] },
): Promise<string> {
	const id = await group.create({ kind: input.kind, parentId: input.parentId, body: input.body, data: input.data });
	const mirrorId = await keepInStudy(userId, group, id, input.kind, copy.title, copy.body, copy.refs, copy.topics);
	if (mirrorId) await group.update(id, { data: { ...input.data, mirrorId } });
	return id;
}

// ---------------------------------------------------------------------------
// The group as a member sees it
// ---------------------------------------------------------------------------

export interface PlanWeekView {
	week: number;
	firstDay: number;
	lastDay: number;
	readings: string;
}

export interface GroupPlanWeeks {
	current: number;
	weeks: PlanWeekView[];
	/** This plan week's chapters, offered to a leader as the week's passage. */
	chapters: string[];
}

export interface GroupPassageView {
	reference: string;
	href: string;
	verses: VerseView[];
	truncated: boolean;
	book: number;
	chapter: number;
	first: number;
	last: number;
}

export interface GroupWeekView {
	id: string;
	reference: string;
	passage: GroupPassageView;
	planWeek: number | null;
	setBy: string;
	createdAt: string;
	topics: string[];
	questions: GroupQuestionView[];
	sessions: GroupSessionView[];
	canDelete: boolean;
	/** Leaders only: SureWord's drafts, and how many more times it may be asked. */
	prep?: { questions: { type: QuestionType; text: string; verses: VerseView[]; added: boolean }[]; leaderNote: string | null; generatedAt: string } | null;
	prepareLeft?: number;
}

export interface GroupView {
	/** Study Rooms' view of the room: members, roles, the plan, and the owner's invite and presets. */
	room: Omit<RoomView, "posts">;
	isLeader: boolean;
	planWeeks: GroupPlanWeeks | null;
	/** Newest first: the first is this week's. */
	weeks: GroupWeekView[];
	prayers: GroupPrayerView[];
	/** The session a leader is running right now, if any. */
	openSession: { weekId: string; sessionId: string } | null;
}

function groupPlanWeeks(room: RoomView): GroupPlanWeeks | null {
	if (!room.plan) return null;
	const preset = buildPresetPlan(room.plan.presetKey);
	if (!preset) return null;
	const weeks = planWeeks(preset.days);
	const current = planWeekOf(room.plan.todayDay);
	const here = weeks[current - 1];
	const chapters = here ? [...new Set(here.days.flatMap((day) => day.readings.map((reading) => `${reading.book} ${reading.chapter}`)))] : [];
	return {
		current,
		weeks: weeks.map((week) => ({ week: week.week, firstDay: week.firstDay, lastDay: week.lastDay, readings: describeReadings(week.days.flatMap((day) => day.readings)) })),
		chapters: chapters.slice(0, 40),
	};
}

export async function getGroupView(userId: string, groupId: string, now = new Date()): Promise<GroupView | null> {
	const [roomView, group] = await Promise.all([getRoomView(userId, groupId, now, GROUP_PURPOSE), openModuleRoom(userId, groupId, GROUP_PURPOSE, GROUPS_MODULE)]);
	if (!roomView || !group) return null;
	const [members, rows] = await Promise.all([group.members(), group.posts()]);
	const viewer = viewerOf(group);
	const leader = isLeader(viewer.role);
	const byUser = new Map<string, ModuleMemberRow>(members.map((member) => [member.userId, member]));
	const byMemberId = new Map<string, ModuleMemberRow>(members.map((member) => [member.id, member]));
	const person = (authorId: string) => personView(byUser.get(authorId), viewer);
	const children = new Map<string, ModulePostRow[]>();
	for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
	const under = (id: string, kind: GroupPostKind) => (children.get(id) ?? []).filter((row) => row.kind === kind);
	const chapters = new Map<string, Promise<string[]>>();
	const chapterOf = (book: number, chapter: number) => {
		const key = `${book}.${chapter}`;
		if (!chapters.has(key)) chapters.set(key, getKjvChapter(book, chapter).catch(() => []));
		return chapters.get(key)!;
	};

	const weeks: GroupWeekView[] = [];
	let openSession: GroupView["openSession"] = null;
	for (const row of rows.filter((candidate) => candidate.kind === "week").reverse()) {
		const data = readWeekData(row.data);
		if (!data.passage) continue;
		const [shown, chapter] = await Promise.all([passageView(data.passage, true, chapters), chapterOf(data.passage.book, data.passage.chapter)]);
		if (!shown || chapter.length === 0) continue;
		const range = passageVerseRange(data.passage, chapter.length);
		const versesOf = (numbers: readonly number[]) => numbers.filter((verse) => verse >= 1 && verse <= chapter.length).map((verse) => ({ verse, text: chapter[verse - 1] }));
		const questions = under(row.id, "question").map((question) =>
			questionView(question, person(question.authorId), viewer, versesOf(readQuestionData(question.data).verses), under(question.id, "reply").map((reply) => replyView(reply, person(reply.authorId), viewer))),
		);
		const sessions = under(row.id, "session").map((session) => {
			const view = sessionView(session, person(session.authorId), viewer);
			if (!view.done && !openSession) openSession = { weekId: row.id, sessionId: session.id };
			return view;
		});
		const taken = new Set(questions.map((question) => question.text));
		weeks.push({
			id: row.id,
			reference: shown.reference,
			passage: { ...shown, book: data.passage.book, chapter: data.passage.chapter, first: range.first, last: range.last },
			planWeek: data.planWeek,
			setBy: (data.setBy && byMemberId.get(data.setBy)?.displayName) || "A leader",
			createdAt: row.createdAt.toISOString(),
			topics: data.topics,
			questions,
			sessions,
			canDelete: canDeleteGroupPost({ kind: "week", authorId: row.authorId }, viewer),
			...(leader && {
				prep: data.prep && {
					questions: data.prep.questions.map((draft) => ({ type: draft.type, text: draft.text, verses: versesOf(draft.verses), added: taken.has(draft.text) })),
					leaderNote: data.prep.leaderNote,
					generatedAt: data.prep.generatedAt,
				},
				prepareLeft: Math.max(PREPARE_PER_WEEK_MAX - data.prepared, 0),
			}),
		});
	}

	const prayers: GroupPrayerView[] = [];
	for (const row of rows.filter((candidate) => candidate.kind === "prayer")) {
		const data = readPrayerData(row.data);
		const book = data.passage ? bookByOrder(data.passage.book) : null;
		const passage = data.passage && book ? { reference: passageLabel(book.name, data.passage), href: readerHref(data.passage) } : null;
		const prayed = under(row.id, "prayed").map((mark) => ({ authorId: mark.authorId, person: person(mark.authorId) }));
		prayers.push(prayerView(row, person(row.authorId), viewer, prayed, passage));
	}

	const { posts: _posts, ...room } = roomView;
	void _posts;
	// Leaders after the owner, then members, each in the order they joined.
	const rank = { owner: 0, leader: 1, member: 2 } as const;
	room.members = [...room.members].sort((a, b) => rank[a.role] - rank[b.role]);
	return { room, isLeader: leader, planWeeks: groupPlanWeeks(roomView), weeks, prayers: sortPrayers(prayers), openSession };
}

// ---------------------------------------------------------------------------
// Adding to the group
// ---------------------------------------------------------------------------

async function weekOf(group: ModuleRoom, weekId: string): Promise<{ row: ModulePostRow; data: WeekData & { passage: GroupPassage } }> {
	const row = await group.post(weekId);
	const data = row?.kind === "week" ? readWeekData(row.data) : null;
	if (!row || !data?.passage) throw new RoomError("That week is no longer in the group.", 409);
	return { row, data: { ...data, passage: data.passage } };
}

/** Adds a week, question, reply, session or prayer request. Returns the new post's id. */
export async function addGroupPost(userId: string, groupId: string, input: unknown, now = new Date()): Promise<string> {
	const checked = checkGroupPost(input);
	if (!checked.ok) throw new RoomError(checked.error);
	const post = checked.value;
	const group = await openGroup(userId, groupId);
	const groupName = group.room.name;

	switch (post.kind) {
		case "week": {
			requireLeader(group);
			const passage = await parsePassage(post.reference);
			const { reference } = await readPassage(passage);
			const day = planDay(group.room, now);
			// The week is the group's, not the leader's: it stays when a leader leaves.
			return group.create({
				kind: "week",
				title: reference,
				body: "",
				asRoom: true,
				data: { passage, refs: passageRefs(passage), topics: post.themes, planWeek: day === null ? null : planWeekOf(day), setBy: group.me.memberId, prep: null, prepared: 0 },
			});
		}

		case "question": {
			requireLeader(group);
			const week = await weekOf(group, post.parentId);
			const siblings = (await group.posts()).filter((row) => row.parentId === week.row.id && row.kind === "question");
			if (siblings.length >= QUESTIONS_PER_WEEK_MAX) throw new RoomError(`A week holds ${QUESTIONS_PER_WEEK_MAX} questions. Remove one to add another.`, 409);
			let text: string;
			let type: QuestionType;
			let verses: number[];
			let prepared = false;
			if ("draft" in post) {
				const draft = week.data.prep?.questions[post.draft];
				if (!draft) throw new RoomError("That prepared question is gone. Ask SureWord again.", 409);
				({ text, type, verses } = draft);
				prepared = true;
			} else {
				({ text, type, verses } = post);
			}
			if (siblings.some((row) => row.body === text)) throw new RoomError("That question is already in this week.", 409);
			const chapter = await getKjvChapter(week.data.passage.book, week.data.passage.chapter);
			const range = passageVerseRange(week.data.passage, chapter.length);
			if (verses.some((verse) => verse < range.first || verse > range.last)) throw new RoomError(`Choose verses from ${week.row.title ?? "this week's passage"}.`);
			const refs = questionRefs(week.data.passage, verses);
			return createWithCopy(
				userId,
				group,
				{ kind: "question", parentId: week.row.id, body: text, data: { refs, topics: week.data.topics, type, verses, prepared } },
				{ title: `Question for ${groupName}, ${week.row.title ?? ""}`, body: text, refs, topics: week.data.topics },
			);
		}

		case "reply": {
			const question = await group.post(post.parentId);
			if (!question || question.kind !== "question") throw new RoomError("That question is no longer in the group.", 409);
			const data = readQuestionData(question.data);
			return createWithCopy(
				userId,
				group,
				{ kind: "reply", parentId: question.id, body: post.body, data: { refs: data.refs, topics: data.topics } },
				{ title: `Reply in ${groupName}: ${question.body}`, body: post.body, refs: data.refs, topics: data.topics },
			);
		}

		case "session": {
			requireLeader(group);
			const week = await weekOf(group, post.parentId);
			const running = (await group.posts()).some((row) => row.kind === "session" && readSessionData(row.data).endedAt === null);
			if (running) throw new RoomError("A session is already running in this group. End it first.", 409);
			const notes = Object.fromEntries(SESSION_STEPS.map((step) => [step, ""]));
			return createWithCopy(
				userId,
				group,
				{ kind: "session", parentId: week.row.id, body: "", data: { refs: week.data.refs, topics: week.data.topics, step: 0, notes, endedAt: null } },
				{ title: `Session notes, ${groupName}: ${week.row.title ?? ""}`, body: "", refs: week.data.refs, topics: week.data.topics },
			);
		}

		case "prayer": {
			let body: string;
			let passage: GroupPassage | null = null;
			let fromPrivateList = false;
			if ("memoryId" in post) {
				// The one read of a private prayer: the caller's own, by their own id, copied in.
				const memory = await prisma.userMemory.findFirst({ where: { id: post.memoryId, userId, category: "prayer" }, select: { content: true } });
				const text = memory?.content.trim();
				if (!text) throw new RoomError("That prayer request was not found in your prayer list.");
				body = text.length > PRAYER_MAX ? `${text.slice(0, PRAYER_MAX - 1).trimEnd()}…` : text;
				fromPrivateList = true;
			} else {
				body = post.body;
				passage = post.reference ? await parsePassage(post.reference) : null;
			}
			const refs = passage ? passageRefs(passage) : [];
			const topics = ["prayer"];
			return createWithCopy(
				userId,
				group,
				{ kind: "prayer", parentId: null, body, data: { refs, topics, ...(passage && { passage }), fromPrivateList, answeredAt: null, answer: null } },
				{ title: `Prayer request shared with ${groupName}`, body, refs, topics },
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Changing and removing
// ---------------------------------------------------------------------------

/** A session's steps and notes, or a prayer's "I prayed" and "answered". */
export async function updateGroupPost(userId: string, groupId: string, postId: string, input: unknown, now = new Date()): Promise<void> {
	const group = await openGroup(userId, groupId);
	const row = await group.post(postId);
	if (!row) throw notFound();
	const viewer = viewerOf(group);

	if (row.kind === "session") {
		const checked = checkSessionPatch(input);
		if (!checked.ok) throw new RoomError(checked.error);
		if (!canEditSession(row, viewer)) throw new RoomError("Only the leader running this session can change it.", 403);
		const data = readSessionData(row.data);
		const patch = checked.value;
		if (data.endedAt && patch.step !== undefined) throw new RoomError("This session has ended.", 409);
		const notes = { ...data.notes, ...patch.notes };
		const next = {
			refs: data.refs,
			topics: data.topics,
			step: patch.step ?? data.step,
			notes,
			endedAt: patch.end ? (data.endedAt ?? now.toISOString()) : data.endedAt,
			...(data.mirrorId && { mirrorId: data.mirrorId }),
		};
		const body = sessionNotesText(notes);
		if (!(await group.update(row.id, { body, data: next }))) throw notFound();
		if (data.mirrorId) await updateBetaItem(userId, data.mirrorId, { body }).catch((error) => console.error("[beta/groups] could not update the study copy", error));
		return;
	}

	if (row.kind === "prayer") {
		const checked = checkPrayerPatch(input);
		if (!checked.ok) throw new RoomError(checked.error);
		const patch = checked.value;
		const data = readPrayerData(row.data);
		if ("prayed" in patch) {
			if (!canMarkPrayed(row, viewer)) throw new RoomError("You asked for this prayer; the others mark that they prayed.", 403);
			const mine = (await group.posts()).filter((mark) => mark.parentId === row.id && mark.kind === "prayed" && mark.authorId === userId);
			if (patch.prayed && mine.length === 0) {
				if (data.answeredAt) throw new RoomError("This prayer has been answered.", 409);
				await group.create({ kind: "prayed", parentId: row.id, body: "", data: { refs: [], topics: ["prayer"] } });
			}
			if (!patch.prayed) for (const mark of mine) await group.remove(mark.id);
			return;
		}
		if (!canAnswerPrayer(row, viewer)) throw new RoomError("Only the person who asked can mark it answered.", 403);
		const answered = patch.answered;
		const next = {
			refs: data.refs,
			topics: data.topics,
			...(data.passage && { passage: data.passage }),
			fromPrivateList: data.fromPrivateList,
			answeredAt: answered ? now.toISOString() : null,
			answer: answered ? patch.answer : null,
			...(data.mirrorId && { mirrorId: data.mirrorId }),
		};
		if (!(await group.update(row.id, { data: next }))) throw notFound();
		if (data.mirrorId) {
			const body = answered && patch.answer ? `${row.body}\n\nAnswered: ${patch.answer}` : row.body;
			await updateBetaItem(userId, data.mirrorId, { title: `${answered ? "Answered prayer" : "Prayer request"} shared with ${group.room.name}`, body }).catch((error) =>
				console.error("[beta/groups] could not update the study copy", error),
			);
		}
		return;
	}

	throw new RoomError("That cannot be changed.");
}

/** Removes a post and everything under it. The author's own copy in their study goes with it. */
export async function deleteGroupPost(userId: string, groupId: string, postId: string): Promise<void> {
	const group = await openGroup(userId, groupId);
	const row = await group.post(postId);
	if (!row) throw notFound();
	if (!canDeleteGroupPost({ kind: row.kind as GroupPostKind, authorId: row.authorId }, viewerOf(group))) {
		throw new RoomError(row.kind === "reply" || row.kind === "prayer" ? "Only its author or a leader can remove that." : "Only the group's leaders can remove that.", 403);
	}
	if (!(await group.remove(row.id))) throw notFound();
	const mirrorId = mirrorIdOf(row.data);
	if (mirrorId && row.authorId === userId) await deleteBetaItem(userId, mirrorId).catch((error) => console.error("[beta/groups] could not remove the study copy", error));
}

// ---------------------------------------------------------------------------
// SureWord prepares a week's questions, when a leader asks
// ---------------------------------------------------------------------------

export async function prepareWeek(userId: string, groupId: string, weekId: string): Promise<void> {
	const group = await openGroup(userId, groupId);
	requireLeader(group);
	if (group.room.archived) throw new RoomError("This group is archived. Its owner can restore it.", 409);
	const week = await weekOf(group, weekId);
	if (week.data.prepared >= PREPARE_PER_WEEK_MAX) throw new RoomError(`SureWord has prepared this week's questions ${PREPARE_PER_WEEK_MAX} times. Write your own, or add from the last set.`, 409);
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
	if (!hasCurrentAiConsent(user)) throw new RoomError("AI is turned off for your account. You can turn it on in Settings, AI.", 403);
	const { reference, verses } = await readPassage(week.data.passage);
	let prep: Awaited<ReturnType<typeof prepareGroupQuestions>>;
	try {
		prep = await prepareGroupQuestions({ userId, reference, verses: verses.slice(0, 80) });
	} catch (error) {
		if (error instanceof GroupQuestionsUnavailableError) throw new RoomError(error.message, 409);
		console.error("[beta/groups] preparing questions failed", error);
		throw new RoomError("SureWord could not prepare questions just now. Try again in a moment.", 409);
	}
	const { dropped: _dropped, ...kept } = prep;
	void _dropped;
	const updated = await group.update(week.row.id, {
		data: {
			passage: week.data.passage,
			refs: week.data.refs,
			topics: cleanTopics([...week.data.topics, ...kept.topics], 8),
			planWeek: week.data.planWeek,
			setBy: week.data.setBy,
			prep: kept,
			prepared: week.data.prepared + 1,
		},
	});
	if (!updated) throw new RoomError("That week is no longer in the group.", 409);
}

// ---------------------------------------------------------------------------
// From the Knowledge Vault back to the group
// ---------------------------------------------------------------------------

/**
 * Where a member's own copy of a contribution points: the group, while they
 * are still in it; otherwise the copy itself, which is theirs to keep.
 */
export async function resolveStudyItem(userId: string, itemId: string): Promise<{ href: string } | { title: string; body: string; group: string } | null> {
	const item = await getBetaItem(userId, itemId);
	if (!item || item.module !== GROUPS_MODULE) return null;
	const data = (typeof item.data === "object" && item.data !== null ? item.data : {}) as Record<string, unknown>;
	const groupId = typeof data.groupId === "string" ? data.groupId : null;
	const group = groupId ? await openModuleRoom(userId, groupId, GROUP_PURPOSE, GROUPS_MODULE) : null;
	if (group) return { href: `/beta/together/groups/${group.room.id}` };
	return { title: item.title, body: item.body ?? "", group: typeof data.group === "string" ? data.group : "a group" };
}
