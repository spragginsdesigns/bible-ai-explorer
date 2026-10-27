"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, HandHeart } from "lucide-react";
import type { GroupView, GroupWeekView } from "@/lib/beta/groups/groups";
import { SESSION_NOTE_MAX, SESSION_STEPS, SESSION_STEP_LABEL, type GroupSessionView, type SessionStep } from "@/lib/beta/groups/groups-rules";
import type { PassageAudio } from "@/components/beta/kids/usePassageAudio";
import { ErrorNote, LocalDate, field, primaryButton, quietButton, secondaryButton } from "@/components/beta/rooms/room-ui";
import type { GroupAct } from "./GroupScreen";
import { ListenControl, PersonName, RemoveButton, TypeChip } from "./group-ui";

const STEP_PROMPT: Record<SessionStep, string> = {
	read: "Read the passage aloud, one person or a few taking turns, or listen to it together.",
	observe: "What does the passage say? Who is speaking and to whom, what is commanded or promised, which words repeat.",
	discuss: "Talk through the questions. Let the text answer first, then each other.",
	pray: "Pray for what the passage calls the group to, and for the requests in the prayer circle.",
};

/**
 * The guided session a leader runs when the group meets. The leader who
 * started it moves through the steps and keeps notes, which are saved to the
 * group; everyone else sees which step the group is on (the screen refreshes
 * every 20 seconds) and the notes so far.
 */
export default function GroupSession({ group, week, session, act, busy, audio }: { group: GroupView; week: GroupWeekView; session: GroupSessionView; act: GroupAct; busy: string | null; audio: PassageAudio | null }) {
	const base = `/api/beta/groups/${group.room.id}/posts/${session.id}`;
	// The leader's typing is theirs until saved: a refresh never overwrites it.
	const [notes, setNotes] = useState<Record<SessionStep, string>>(session.notes);
	const [error, setError] = useState<string | null>(null);
	const [confirmEnd, setConfirmEnd] = useState(false);
	const leading = session.canEdit && !group.room.archived;
	const stepKey = SESSION_STEPS[session.step];
	const shownNotes = leading ? notes : session.notes;
	const dirty = leading && SESSION_STEPS.some((step) => notes[step] !== session.notes[step]);

	const save = async (key: string, body: Record<string, unknown>) => {
		setError(null);
		const result = await act(key, base, { method: "PATCH", body: { notes, ...body } });
		if (!result.ok) setError(result.error);
		return result.ok;
	};
	const go = (step: number) => void save(`session-step-${step}`, { step });
	const end = async () => {
		if (await save("session-end", { end: true })) setConfirmEnd(false);
	};
	const remove = async () => {
		setError(null);
		const result = await act(`delete-${session.id}`, base, { method: "DELETE" });
		if (!result.ok) setError(result.error);
	};
	const observe = week.questions.filter((question) => question.type === "observe");
	const discuss = week.questions.filter((question) => question.type !== "observe");
	const open = group.prayers.filter((prayer) => !prayer.answered);

	return (
		<section id="group-session" aria-labelledby="session-title" className="mt-5 scroll-mt-24 rounded-2xl border border-amber-700/30 bg-amber-500/[.05] px-4 py-4 dark:border-amber-300/25">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3">
				<h3 id="session-title" className="font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">
					The session
				</h3>
				<p className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-[#bbb3a7]">
					Led by <PersonName person={session.leader} />
					{/* Another leader can clear a session its own leader can no longer move, so the next one can start. */}
					{!leading && session.canDelete && !group.room.archived && <RemoveButton label="Remove this session" busy={busy === `delete-${session.id}`} onRemove={() => void remove()} />}
				</p>
			</div>

			<ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Steps">
				{SESSION_STEPS.map((step, index) => {
					const here = index === session.step;
					const past = index < session.step;
					return (
						<li key={step} aria-current={here ? "step" : undefined} className={`rounded-2xl px-1 py-2 text-center text-xs font-bold sm:text-sm ${here ? "bg-[#e5b664] text-[#1c2118]" : past ? "bg-black/[.06] text-neutral-700 dark:bg-white/[.08] dark:text-[#d9d1c3]" : "border border-black/10 text-neutral-600 dark:border-white/10 dark:text-[#bbb3a7]"}`}>
							{past && <Check size={12} className="-mt-0.5 mr-0.5 inline" aria-hidden />}
							{index + 1}. {SESSION_STEP_LABEL[step]}
						</li>
					);
				})}
			</ol>

			<div className="mt-4">
				<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
					Step {session.step + 1} of {SESSION_STEPS.length}: {SESSION_STEP_LABEL[stepKey]}
				</p>
				<p className="mt-1 leading-7">{STEP_PROMPT[stepKey]}</p>

				{stepKey === "read" && (
					<div className="mt-2 flex flex-wrap items-center gap-2">
						{audio && <ListenControl reference={week.reference} audio={audio} />}
						<span className="text-sm text-neutral-600 dark:text-[#bbb3a7]">{week.reference} is above, in the King James text.</span>
					</div>
				)}
				{stepKey === "observe" && <QuestionList questions={observe} empty="No observation questions this week; ask what the group notices." />}
				{stepKey === "discuss" && <QuestionList questions={discuss} empty="No discussion questions this week." withReplies />}
				{stepKey === "pray" && (
					<div className="mt-2">
						{open.length === 0 ? (
							<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">No open requests in the prayer circle.</p>
						) : (
							<ul className="space-y-2">
								{open.map((prayer) => (
									<li key={prayer.id} className="flex gap-2.5 text-sm leading-6">
										<HandHeart size={16} className="mt-1 shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
										<span className="min-w-0">
											<span className="font-bold">{prayer.author.isYou ? "You" : prayer.author.displayName}:</span> <span className="[overflow-wrap:anywhere]">{prayer.body}</span>
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>

			<div className="mt-4">
				{leading ? (
					<label className="block">
						<span className="mb-1.5 block text-sm font-bold">Notes for {SESSION_STEP_LABEL[stepKey]}</span>
						<textarea
							value={notes[stepKey]}
							onChange={(event) => setNotes((current) => ({ ...current, [stepKey]: event.target.value }))}
							maxLength={SESSION_NOTE_MAX}
							rows={4}
							placeholder="What the group saw, said or asked to pray for. Saved to the group."
							className={`${field} resize-y`}
						/>
					</label>
				) : (
					shownNotes[stepKey].trim() && (
						<div>
							<p className="text-sm font-bold">Notes so far</p>
							<p className="mt-1 whitespace-pre-line text-sm leading-6 [overflow-wrap:anywhere]">{shownNotes[stepKey]}</p>
						</div>
					)
				)}
			</div>

			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{leading && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{session.step > 0 && (
						<button type="button" onClick={() => go(session.step - 1)} disabled={busy !== null} className={secondaryButton}>
							<ChevronLeft size={17} aria-hidden /> Back
						</button>
					)}
					{session.step < SESSION_STEPS.length - 1 ? (
						<button type="button" onClick={() => go(session.step + 1)} disabled={busy !== null} className={primaryButton}>
							{busy === `session-step-${session.step + 1}` ? "Saving…" : `Next: ${SESSION_STEP_LABEL[SESSION_STEPS[session.step + 1]]}`} <ChevronRight size={17} aria-hidden />
						</button>
					) : (
						!confirmEnd && (
							<button type="button" onClick={() => setConfirmEnd(true)} disabled={busy !== null} className={primaryButton}>
								End the session
							</button>
						)
					)}
					{dirty && (
						<button type="button" onClick={() => void save("session-save", {})} disabled={busy !== null} className={quietButton}>
							{busy === "session-save" ? "Saving…" : "Save notes"}
						</button>
					)}
				</div>
			)}
			{leading && confirmEnd && (
				<div className="mt-3 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 dark:bg-white/[.04]">
					<p>End the session? Its notes stay with this week for the whole group to read.</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button type="button" onClick={() => void end()} disabled={busy !== null} className={primaryButton}>
							{busy === "session-end" ? "Ending…" : "End and save"}
						</button>
						<button type="button" onClick={() => setConfirmEnd(false)} className={quietButton}>
							Keep going
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

function QuestionList({ questions, empty, withReplies }: { questions: GroupWeekView["questions"]; empty: string; withReplies?: boolean }) {
	if (questions.length === 0) return <p className="mt-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">{empty}</p>;
	return (
		<ol className="mt-2 space-y-2">
			{questions.map((question) => (
				<li key={question.id} className="rounded-2xl bg-white/50 px-3 py-2.5 dark:bg-white/[.04]">
					<TypeChip type={question.type} />
					<p className="mt-1 leading-7 [overflow-wrap:anywhere]">{question.text}</p>
					{withReplies && question.replies.length > 0 && <p className="text-xs text-neutral-600 dark:text-[#bbb3a7]">{question.replies.length === 1 ? "1 answer below" : `${question.replies.length} answers below`}</p>}
				</li>
			))}
		</ol>
	);
}

/** An ended session's notes, step by step, kept with its week. */
export function SessionNotes({ group, session, act, busy }: { group: GroupView; session: GroupSessionView; act: GroupAct; busy: string | null }) {
	const [error, setError] = useState<string | null>(null);
	const written = SESSION_STEPS.filter((step) => session.notes[step].trim());
	const remove = async () => {
		setError(null);
		const result = await act(`delete-${session.id}`, `/api/beta/groups/${group.room.id}/posts/${session.id}`, { method: "DELETE" });
		if (!result.ok) setError(result.error);
	};
	return (
		<article className="rounded-2xl border border-black/[.09] px-4 py-3 dark:border-white/[.09]" aria-label="Session notes">
			<div className="flex items-start justify-between gap-2">
				<p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-neutral-600 dark:text-[#bbb3a7]">
					<LocalDate iso={session.endedAt ?? session.startedAt} /> · led by <PersonName person={session.leader} />
				</p>
				{session.canDelete && !group.room.archived && <RemoveButton label="Remove these session notes" busy={busy === `delete-${session.id}`} onRemove={() => void remove()} />}
			</div>
			{written.length === 0 ? (
				<p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">No notes were taken.</p>
			) : (
				<dl className="mt-1 space-y-2">
					{written.map((step) => (
						<div key={step}>
							<dt className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">{SESSION_STEP_LABEL[step]}</dt>
							<dd className="whitespace-pre-line text-sm leading-6 [overflow-wrap:anywhere]">{session.notes[step]}</dd>
						</div>
					))}
				</dl>
			)}
			{error && (
				<div className="mt-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
		</article>
	);
}
