"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, CalendarRange, Loader2, MessagesSquare, Sparkles, UserPlus } from "lucide-react";
import type { GroupView, GroupWeekView } from "@/lib/beta/groups/groups";
import { GROUP_QUESTION_MAX, GROUP_REPLY_MAX, QUESTION_TYPES, QUESTION_TYPE_LABEL, type GroupQuestionView, type QuestionType } from "@/lib/beta/groups/groups-rules";
import { usePassageAudio, type PassageAudio } from "@/components/beta/kids/usePassageAudio";
import { ErrorNote, LocalDate, RelativeTime, card, eyebrow, field, primaryButton, quietButton, secondaryButton } from "@/components/beta/rooms/room-ui";
import type { GroupAct } from "./GroupScreen";
import GroupSession, { SessionNotes } from "./GroupSession";
import { ListenControl, PersonName, RemoveButton, TypeChip, VerseLines, parseVerseList } from "./group-ui";

interface Props {
	group: GroupView;
	act: GroupAct;
	busy: string | null;
}

export default function GroupWeeks({ group, act, busy, onSetWeek, onInvite }: Props & { onSetWeek: () => void; onInvite: () => void }) {
	const [current, ...earlier] = group.weeks;
	const room = group.room;
	const alone = room.members.length === 1;

	return (
		<div className="space-y-4">
			{!current ? (
				<section className={`${card} px-5 py-6`} aria-labelledby="week-empty">
					<CalendarRange size={24} strokeWidth={1.6} className="text-amber-800 dark:text-[#e5b664]" aria-hidden />
					<h2 id="week-empty" className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">
						No passage for this week yet
					</h2>
					<p className="mt-1 leading-7 text-neutral-700 dark:text-[#d9d1c3]">
						{group.isLeader
							? "Set the passage the group will read and talk about this week. SureWord can then help you prepare the questions."
							: "One of the group's leaders sets each week's passage. It shows here, with the questions to talk through."}
					</p>
					<div className="mt-4 flex flex-wrap gap-2">
						{group.isLeader && !room.archived && (
							<button type="button" onClick={onSetWeek} className={primaryButton}>
								<BookOpen size={17} aria-hidden /> Set this week&rsquo;s passage
							</button>
						)}
						{alone && room.isOwner && !room.archived && (
							<button type="button" onClick={onInvite} className={secondaryButton}>
								<UserPlus size={17} aria-hidden /> Invite your group
							</button>
						)}
					</div>
				</section>
			) : (
				<>
					{/* Keyed by week: when a leader starts the next one, a half-written question never moves to it. */}
					<WeekCard key={current.id} group={group} week={current} act={act} busy={busy} current />
					{group.isLeader && !room.archived && (
						<button type="button" onClick={onSetWeek} className={`${secondaryButton} w-full sm:w-auto`}>
							<CalendarRange size={17} aria-hidden /> Start next week
						</button>
					)}
				</>
			)}

			{earlier.length > 0 && (
				<section aria-labelledby="weeks-earlier" className="pt-2">
					<h2 id="weeks-earlier" className={eyebrow}>
						Earlier weeks
					</h2>
					<ul className="mt-3 space-y-3">
						{earlier.map((week) => (
							<li key={week.id}>
								<details className={`${card} group/details`}>
									<summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
										<span className="min-w-0 flex-1">
											<span className="block font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-tight">{week.reference}</span>
											<span className="block text-sm text-neutral-600 dark:text-[#bbb3a7]">
												<LocalDate iso={week.createdAt} /> · {week.questions.length === 1 ? "1 question" : `${week.questions.length} questions`}
												{week.sessions.some((session) => session.done) && " · session notes"}
											</span>
										</span>
										<span className="text-sm font-bold text-amber-800 group-open/details:hidden dark:text-[#e5b664]">Open</span>
										<span className="hidden text-sm font-bold text-amber-800 group-open/details:inline dark:text-[#e5b664]">Close</span>
									</summary>
									<div className="border-t border-black/[.08] px-1 pb-1 dark:border-white/[.08]">
										<WeekCard group={group} week={week} act={act} busy={busy} current={false} />
									</div>
								</details>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

function WeekCard({ group, week, act, busy, current }: Props & { week: GroupWeekView; current: boolean }) {
	const room = group.room;
	const base = `/api/beta/groups/${room.id}`;
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ text: string; type: QuestionType; verses: number[] } | null>(null);
	const session = week.sessions.find((candidate) => !candidate.done) ?? null;
	const ended = week.sessions.filter((candidate) => candidate.done);
	const otherRunning = group.openSession !== null && group.openSession.weekId !== week.id;
	// The audio Bible's own recording of this week's passage, for the reader and the session's Read step.
	const audio = usePassage(week, current);

	const startSession = async () => {
		setError(null);
		const result = await act(`session-${week.id}`, `${base}/posts`, { method: "POST", body: { kind: "session", parentId: week.id } });
		if (!result.ok) setError(result.error);
		else window.setTimeout(() => document.getElementById("group-session")?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
	};
	const removeWeek = async () => {
		const result = await act(`delete-${week.id}`, `${base}/posts/${week.id}`, { method: "DELETE" });
		if (!result.ok) setError(result.error);
	};

	return (
		<article className={current ? `${card} px-4 py-5 sm:px-6` : "px-4 py-4"} aria-label={`${current ? "This week" : "Week"}: ${week.reference}`}>
			<div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
				<p className={eyebrow}>
					{current ? "This week" : "Week of"} {!current && <LocalDate iso={week.createdAt} />}
					{week.planWeek !== null && ` · plan week ${week.planWeek}`}
				</p>
				{week.canDelete && !room.archived && <RemoveButton label={`Remove the week of ${week.reference}`} busy={busy === `delete-${week.id}`} confirm="Remove the week" onRemove={() => void removeWeek()} />}
			</div>
			<h2 className="mt-1 font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">{week.reference}</h2>
			<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">
				Set by {week.setBy} · <RelativeTime iso={week.createdAt} />
			</p>
			{week.topics.length > 0 && (
				<ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Themes">
					{week.topics.map((topic) => (
						<li key={topic} className="rounded-full border border-black/10 px-2.5 py-0.5 text-xs font-bold text-neutral-700 dark:border-white/10 dark:text-[#d9d1c3]">
							{topic}
						</li>
					))}
				</ul>
			)}

			<Passage week={week} audio={current ? audio : null} />

			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{session && <GroupSession group={group} week={week} session={session} act={act} busy={busy} audio={current ? audio : null} />}
			{current && !session && group.isLeader && !room.archived && (
				<div className="mt-5 rounded-2xl border border-black/10 px-4 py-4 dark:border-white/10">
					<h3 className="text-sm font-bold">The meeting</h3>
					<p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						Run the session step by step when the group meets: read the passage aloud or together, observe, discuss the questions, then pray. Your notes are saved to the group.
					</p>
					<button type="button" onClick={() => void startSession()} disabled={busy !== null || otherRunning} className={`${primaryButton} mt-3`}>
						{busy === `session-${week.id}` ? "Starting…" : "Run the session"}
					</button>
					{otherRunning && <p className="mt-2 text-xs text-neutral-600 dark:text-[#bbb3a7]">A session for another week is running. End it first.</p>}
				</div>
			)}

			<section aria-label="Discussion" className="mt-6">
				<h3 className="flex items-center gap-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">
					<MessagesSquare size={19} strokeWidth={1.8} className="text-amber-800 dark:text-[#e5b664]" aria-hidden /> Discussion
				</h3>
				{week.questions.length === 0 ? (
					<p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
						{group.isLeader ? "No questions yet. Prepare them with SureWord below, or write your own." : "The leaders have not added this week's questions yet."}
					</p>
				) : (
					<ol className="mt-3 space-y-3">
						{week.questions.map((question) => (
							<li key={question.id}>
								<QuestionCard group={group} week={week} question={question} act={act} busy={busy} />
							</li>
						))}
					</ol>
				)}
			</section>

			{current && group.isLeader && !room.archived && (
				<>
					<Prepare group={group} week={week} act={act} busy={busy} onEdit={(draft) => setEditing(draft)} />
					<AddQuestion key={editing ? `${editing.text}` : "new"} group={group} week={week} act={act} busy={busy} initial={editing} onDone={() => setEditing(null)} />
				</>
			)}

			{ended.length > 0 && (
				<section aria-label="Session notes" className="mt-6">
					<h3 className="font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">Session notes</h3>
					<ul className="mt-2 space-y-3">
						{ended.map((done) => (
							<li key={done.id}>
								<SessionNotes group={group} session={done} act={act} busy={busy} />
							</li>
						))}
					</ul>
				</section>
			)}
		</article>
	);
}

function Passage({ week, audio }: { week: GroupWeekView; audio: PassageAudio | null }) {
	const reading = audio?.current ? Number(audio.current.split(":")[1]) : null;
	return (
		<div className="mt-4 rounded-2xl bg-black/[.025] px-4 py-4 dark:bg-white/[.03]">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">KJV</p>
				<span className="flex flex-wrap items-center gap-1">
					{audio && <ListenControl reference={week.reference} audio={audio} />}
					<Link href={week.passage.href} className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
						<BookOpen size={16} aria-hidden /> Open in the Bible
					</Link>
				</span>
			</div>
			<div className="mt-2">
				<VerseLines verses={week.passage.verses} current={reading} />
			</div>
			{week.passage.truncated && (
				<Link href={week.passage.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
					Continue in the Bible
				</Link>
			)}
		</div>
	);
}

/**
 * The audio Bible's own recording of the passage, played the way SureWord Kids
 * plays an adventure (`usePassageAudio`): nothing generated, nothing bought.
 * An earlier week's card has no player, so nothing is fetched for it.
 */
function usePassage(week: GroupWeekView, on: boolean): PassageAudio {
	const segments = useMemo(() => (on ? [{ chapter: week.passage.chapter, from: week.passage.first, to: week.passage.last }] : []), [on, week.passage.chapter, week.passage.first, week.passage.last]);
	return usePassageAudio(week.passage.book, segments);
}


function QuestionCard({ group, week, question, act, busy }: Props & { week: GroupWeekView; question: GroupQuestionView }) {
	const base = `/api/beta/groups/${group.room.id}`;
	const [error, setError] = useState<string | null>(null);
	const remove = async (id: string) => {
		setError(null);
		const result = await act(`delete-${id}`, `${base}/posts/${id}`, { method: "DELETE" });
		if (!result.ok) setError(result.error);
	};
	const verseLabel = question.verses.length ? `${week.reference.split(":")[0]}:${question.verses.map((verse) => verse.verse).join(", ")}` : null;

	return (
		<article className="rounded-2xl border border-black/[.09] px-4 py-4 dark:border-white/[.09]" aria-label={`${QUESTION_TYPE_LABEL[question.type]} question`}>
			<div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
				<span className="flex flex-wrap items-center gap-2">
					<TypeChip type={question.type} />
					{question.prepared && (
						<span className="flex items-center gap-1 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
							<Sparkles size={12} aria-hidden /> Prepared with SureWord
						</span>
					)}
				</span>
				{question.canDelete && !group.room.archived && <RemoveButton label="Remove this question" busy={busy === `delete-${question.id}`} onRemove={() => void remove(question.id)} />}
			</div>
			<p className="mt-2 font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{question.text}</p>
			{question.verses.length > 0 && (
				<div className="mt-2 border-l-2 border-amber-700/25 pl-3 dark:border-amber-300/25">
					<p className="text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">{verseLabel} (KJV)</p>
					<VerseLines verses={question.verses} size="sm" />
				</div>
			)}

			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{(question.replies.length > 0 || !group.room.archived) && (
				<div className="mt-3 border-t border-black/[.08] pt-3 dark:border-white/[.08]">
					{question.replies.length > 0 && (
						<ul className="space-y-3" aria-label="Replies">
							{question.replies.map((reply) => (
								<li key={reply.id} className="border-l-2 border-amber-700/25 pl-3 dark:border-amber-300/25">
									<div className="flex items-start justify-between gap-2">
										<span className="flex min-w-0 items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
											<PersonName person={reply.author} />
											<span aria-hidden>·</span>
											<RelativeTime iso={reply.createdAt} className="shrink-0" />
										</span>
										{reply.canDelete && !group.room.archived && <RemoveButton label="Remove this reply" busy={busy === `delete-${reply.id}`} onRemove={() => void remove(reply.id)} />}
									</div>
									<p className="-mt-1 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{reply.body}</p>
								</li>
							))}
						</ul>
					)}
					{!group.room.archived && <ReplyBox group={group} question={question} act={act} busy={busy} />}
				</div>
			)}
		</article>
	);
}

function ReplyBox({ group, question, act, busy }: Props & { question: GroupQuestionView }) {
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!body.trim() || busy) return;
		setError(null);
		const result = await act(`reply-${question.id}`, `/api/beta/groups/${group.room.id}/posts`, { method: "POST", body: { kind: "reply", parentId: question.id, body } });
		if (result.ok) setBody("");
		else setError(result.error);
	};
	return (
		<form onSubmit={submit} className={question.replies.length > 0 ? "mt-3" : undefined}>
			<div className="flex items-end gap-2">
				<label className="sr-only" htmlFor={`reply-${question.id}`}>
					Your answer
				</label>
				<textarea
					id={`reply-${question.id}`}
					value={body}
					onChange={(event) => setBody(event.target.value)}
					maxLength={GROUP_REPLY_MAX}
					rows={1}
					placeholder="Share your answer…"
					className="min-h-11 flex-1 resize-none rounded-[22px] border border-black/10 bg-white/80 px-4 py-2.5 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/40"
				/>
				<button type="submit" disabled={!body.trim() || busy !== null} aria-label="Send your answer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118] transition-opacity disabled:opacity-35">
					<ArrowUp size={20} aria-hidden />
				</button>
			</div>
			{error && (
				<div className="mt-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
		</form>
	);
}

/** A leader asks SureWord to draft the week's questions, then chooses which reach the group. */
function Prepare({ group, week, act, busy, onEdit }: Props & { week: GroupWeekView; onEdit: (draft: { text: string; type: QuestionType; verses: number[] }) => void }) {
	const base = `/api/beta/groups/${group.room.id}`;
	const [error, setError] = useState<string | null>(null);
	const prep = week.prep ?? null;
	const left = week.prepareLeft ?? 0;
	const preparing = busy === `prepare-${week.id}`;

	const prepare = async () => {
		setError(null);
		const result = await act(`prepare-${week.id}`, `${base}/posts/${week.id}/prepare`, { method: "POST" });
		if (!result.ok) setError(result.error);
	};
	const add = async (index: number) => {
		setError(null);
		const result = await act(`draft-${week.id}-${index}`, `${base}/posts`, { method: "POST", body: { kind: "question", parentId: week.id, draft: index } });
		if (!result.ok) setError(result.error);
	};

	return (
		<section aria-labelledby={`prep-${week.id}`} className="mt-6 rounded-2xl border border-dashed border-amber-800/30 px-4 py-4 dark:border-amber-200/25">
			<h3 id={`prep-${week.id}`} className="flex items-center gap-2 text-sm font-bold">
				<Sparkles size={16} className="text-amber-800 dark:text-[#e5b664]" aria-hidden /> Prepare with SureWord
				<span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">· leaders only</span>
			</h3>
			{!prep ? (
				<p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					SureWord drafts questions on {week.reference} for you to choose from, to observe, interpret and apply the passage. Nothing reaches the group until you add it.
				</p>
			) : (
				<>
					{prep.leaderNote && (
						<div className="mt-3 rounded-2xl bg-black/[.035] px-4 py-3 dark:bg-white/[.04]">
							<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Background for leaders · SureWord&rsquo;s interpretation, not Scripture</p>
							<p className="mt-1 text-sm leading-6">{prep.leaderNote}</p>
						</div>
					)}
					<ol className="mt-3 space-y-2.5">
						{prep.questions.map((draft, index) => (
							<li key={`${index}-${draft.text}`} className="rounded-2xl border border-black/[.08] px-4 py-3 dark:border-white/[.08]">
								<TypeChip type={draft.type} />
								<p className="mt-1.5 leading-7 [overflow-wrap:anywhere]">{draft.text}</p>
								{draft.verses.length > 0 && <p className="text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">{`${week.reference.split(":")[0]}:${draft.verses.map((verse) => verse.verse).join(", ")}`}</p>}
								<div className="mt-1.5 flex flex-wrap gap-1">
									{draft.added ? (
										<span className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-neutral-600 dark:text-[#bbb3a7]">Added</span>
									) : (
										<>
											<button type="button" onClick={() => void add(index)} disabled={busy !== null} className={`${quietButton} -ml-3`}>
												{busy === `draft-${week.id}-${index}` ? "Adding…" : "Add to this week"}
											</button>
											<button type="button" onClick={() => onEdit({ text: draft.text, type: draft.type, verses: draft.verses.map((verse) => verse.verse) })} className={quietButton}>
												Edit first
											</button>
										</>
									)}
								</div>
							</li>
						))}
					</ol>
				</>
			)}
			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
			{left > 0 ? (
				<div className="mt-3">
					<button type="button" onClick={() => void prepare()} disabled={busy !== null} className={prep ? secondaryButton : primaryButton}>
						{preparing ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
						{preparing ? "Preparing, about half a minute…" : prep ? "Ask again" : "Prepare questions"}
					</button>
					<p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">
						Drafted from the KJV text above. Check each one before you add it. {left === 1 ? "1 more time" : `${left} times`} this week.
					</p>
				</div>
			) : (
				<p className="mt-3 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">SureWord has prepared this week three times. Add from the set above, or write your own.</p>
			)}
		</section>
	);
}

function AddQuestion({ group, week, act, busy, initial, onDone }: Props & { week: GroupWeekView; initial: { text: string; type: QuestionType; verses: number[] } | null; onDone: () => void }) {
	const [open, setOpen] = useState(initial !== null);
	const [text, setText] = useState(initial?.text ?? "");
	const [type, setType] = useState<QuestionType>(initial?.type ?? "interpret");
	const [verses, setVerses] = useState(initial?.verses.join(", ") ?? "");
	const [error, setError] = useState<string | null>(null);
	const parsed = parseVerseList(verses);
	const formRef = useRef<HTMLFormElement>(null);
	// "Edit first" on a prepared question opens this form with it: bring it into view.
	useEffect(() => {
		if (initial) formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [initial]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!text.trim() || busy || parsed === null) return;
		setError(null);
		const result = await act(`question-${week.id}`, `/api/beta/groups/${group.room.id}/posts`, { method: "POST", body: { kind: "question", parentId: week.id, text, type, verses: parsed } });
		if (result.ok) {
			setText("");
			setVerses("");
			setOpen(false);
			onDone();
		} else setError(result.error);
	};

	if (!open) {
		return (
			<button type="button" onClick={() => setOpen(true)} className={`${quietButton} -ml-3 mt-3`}>
				Write a question of your own
			</button>
		);
	}
	return (
		<form ref={formRef} onSubmit={submit} className="mt-4 space-y-3 rounded-2xl border border-black/10 px-4 py-4 dark:border-white/10" aria-label="Add a question">
			<fieldset>
				<legend className="mb-1.5 text-sm font-bold">Kind of question</legend>
				<div className="flex flex-wrap gap-1.5">
					{QUESTION_TYPES.map((value) => (
						<label key={value} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-bold ${type === value ? "border-amber-700/40 bg-amber-500/[.12] dark:border-amber-300/40" : "border-black/10 dark:border-white/10"}`}>
							<input type="radio" name={`type-${week.id}`} value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
							{QUESTION_TYPE_LABEL[value]}
						</label>
					))}
				</div>
			</fieldset>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Question</span>
				<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={GROUP_QUESTION_MAX} rows={3} required className={`${field} resize-none`} />
			</label>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">
					Verses it rests on <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional, from {week.reference})</span>
				</span>
				<input value={verses} onChange={(event) => setVerses(event.target.value)} inputMode="numeric" placeholder={`${week.passage.first}-${Math.min(week.passage.first + 1, week.passage.last)}`} className={field} />
				{parsed === null && <span className="mt-1 block text-xs font-bold text-red-800 dark:text-red-300">Verse numbers, like 19 or 19-20.</span>}
			</label>
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap gap-2">
				<button type="submit" disabled={busy !== null || !text.trim() || parsed === null} className={primaryButton}>
					{busy === `question-${week.id}` ? "Adding…" : "Add the question"}
				</button>
				<button
					type="button"
					onClick={() => {
						setOpen(false);
						onDone();
					}}
					className={quietButton}
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
