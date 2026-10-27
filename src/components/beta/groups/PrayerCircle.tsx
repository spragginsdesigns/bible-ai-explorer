"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, HandHeart, ListChecks, Lock, Sparkle } from "lucide-react";
import type { GroupView } from "@/lib/beta/groups/groups";
import { PRAYER_ANSWER_MAX, PRAYER_MAX, type GroupPrayerView } from "@/lib/beta/groups/groups-rules";
import { Avatar, ErrorNote, RelativeTime, card, field, primaryButton, quietButton, secondaryButton } from "@/components/beta/rooms/room-ui";
import type { GroupAct } from "./GroupScreen";
import { PersonName, RemoveButton } from "./group-ui";

/**
 * The group's prayer circle. Members share requests (typed here, or a copy of
 * one from their own prayer list), the others mark that they prayed, and the
 * person who asked marks it answered.
 */
export default function PrayerCircle({ group, act, busy, onSharePrivate }: { group: GroupView; act: GroupAct; busy: string | null; onSharePrivate: () => void }) {
	const open = group.prayers.filter((prayer) => !prayer.answered);
	const answered = group.prayers.filter((prayer) => prayer.answered);
	return (
		<div className="space-y-4">
			{!group.room.archived && <Compose group={group} act={act} busy={busy} onSharePrivate={onSharePrivate} />}
			{group.prayers.length === 0 ? (
				<div className={`${card} px-5 py-6`}>
					<HandHeart size={24} strokeWidth={1.6} className="text-amber-800 dark:text-[#e5b664]" aria-hidden />
					<h2 className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">No prayer requests yet</h2>
					<p className="mt-1 leading-7 text-neutral-700 dark:text-[#d9d1c3]">Share what the group can carry to the Lord with you. The others can mark that they prayed, and you can mark it answered.</p>
				</div>
			) : (
				<>
					{open.length > 0 && (
						<ul className="space-y-3" aria-label="Open requests">
							{open.map((prayer) => (
								<li key={prayer.id}>
									<PrayerCard group={group} prayer={prayer} act={act} busy={busy} />
								</li>
							))}
						</ul>
					)}
					{answered.length > 0 && (
						<section aria-labelledby="prayers-answered">
							<h2 id="prayers-answered" className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">
								Answered
							</h2>
							<ul className="mt-2 space-y-3">
								{answered.map((prayer) => (
									<li key={prayer.id}>
										<PrayerCard group={group} prayer={prayer} act={act} busy={busy} />
									</li>
								))}
							</ul>
						</section>
					)}
				</>
			)}
		</div>
	);
}

function Compose({ group, act, busy, onSharePrivate }: { group: GroupView; act: GroupAct; busy: string | null; onSharePrivate: () => void }) {
	const [body, setBody] = useState("");
	const [reference, setReference] = useState("");
	const [withVerse, setWithVerse] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!body.trim() || busy) return;
		setError(null);
		const result = await act("prayer", `/api/beta/groups/${group.room.id}/posts`, { method: "POST", body: { kind: "prayer", body, reference: withVerse ? reference : null } });
		if (result.ok) {
			setBody("");
			setReference("");
			setWithVerse(false);
		} else setError(result.error);
	};
	return (
		<form onSubmit={submit} className={`${card} space-y-3 p-4 sm:p-5`} aria-label="Share a prayer request">
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Share a prayer request</span>
				<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={PRAYER_MAX} rows={3} placeholder="What can the group pray for?" className={`${field} resize-none`} />
			</label>
			{withVerse ? (
				<label className="block">
					<span className="mb-1.5 block text-sm font-bold">
						A verse you are standing on <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional)</span>
					</span>
					<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} placeholder="Philippians 4:6-7" className={field} />
				</label>
			) : (
				<button type="button" onClick={() => setWithVerse(true)} className={`${quietButton} -ml-3`}>
					<BookOpen size={16} aria-hidden /> Add a verse
				</button>
			)}
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap items-center gap-2">
				<button type="submit" disabled={busy !== null || !body.trim()} className={primaryButton}>
					{busy === "prayer" ? "Sharing…" : "Share with the group"}
				</button>
				<button type="button" onClick={onSharePrivate} className={secondaryButton}>
					<ListChecks size={17} aria-hidden /> From my prayer list
				</button>
			</div>
			<p className="flex gap-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">
				<Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
				Your prayer list stays private. Sharing one of its requests puts a copy here, and only that one.
			</p>
		</form>
	);
}

function PrayerCard({ group, prayer, act, busy }: { group: GroupView; prayer: GroupPrayerView; act: GroupAct; busy: string | null }) {
	const base = `/api/beta/groups/${group.room.id}/posts/${prayer.id}`;
	const [answering, setAnswering] = useState(false);
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const patch = async (key: string, body: Record<string, unknown>) => {
		setError(null);
		const result = await act(key, base, { method: "PATCH", body });
		if (!result.ok) setError(result.error);
		return result.ok;
	};
	const remove = async () => {
		setError(null);
		const result = await act(`delete-${prayer.id}`, base, { method: "DELETE" });
		if (!result.ok) setError(result.error);
	};
	// "Ruth and Mary prayed". Your own mark is the toggle's "You prayed", so it is not repeated here.
	const names = prayer.prayedBy.filter((person) => !person.isYou).map((person) => person.displayName);
	const prayedLine = names.length === 0 ? null : `${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]} prayed`;
	const archived = group.room.archived;

	return (
		<article className={`${card} px-4 py-4 sm:px-5`} aria-label={`Prayer request from ${prayer.author.isYou ? "you" : prayer.author.displayName}`}>
			<div className="flex items-start justify-between gap-2">
				<span className="flex min-w-0 items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
					<Avatar name={prayer.author.displayName} size="sm" />
					<PersonName person={prayer.author} />
					<span aria-hidden>·</span>
					<RelativeTime iso={prayer.createdAt} className="shrink-0" />
				</span>
				{prayer.canDelete && !archived && <RemoveButton label="Remove this prayer request" busy={busy === `delete-${prayer.id}`} onRemove={() => void remove()} />}
			</div>
			{prayer.fromPrivateList && (
				<p className="mt-2 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Shared from {prayer.author.isYou ? "your" : `${prayer.author.displayName}'s`} prayer list</p>
			)}
			<p className="mt-2 whitespace-pre-line text-[17px] leading-7 [overflow-wrap:anywhere]">{prayer.body}</p>
			{prayer.passage && (
				<Link href={prayer.passage.href} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-amber-800/20 bg-amber-500/[.08] px-3 text-xs font-bold text-amber-900 hover:bg-amber-500/[.16] dark:border-amber-200/20 dark:text-amber-200">
					<BookOpen size={13} aria-hidden /> {prayer.passage.reference}
				</Link>
			)}

			{prayer.answered && (
				<div className="mt-3 rounded-2xl bg-emerald-500/[.08] px-4 py-3 dark:bg-emerald-300/[.07]">
					<p className="flex items-center gap-1.5 text-sm font-bold text-emerald-900 dark:text-emerald-200">
						<Sparkle size={15} aria-hidden /> Answered · <RelativeTime iso={prayer.answered.at} />
					</p>
					{prayer.answered.note && <p className="mt-1 whitespace-pre-line text-sm leading-6 [overflow-wrap:anywhere]">{prayer.answered.note}</p>}
				</div>
			)}

			{prayedLine && <p className="mt-3 text-sm text-neutral-700 dark:text-[#d9d1c3]">{prayedLine}</p>}

			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{!archived && (
				<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[.08] pt-3 dark:border-white/[.08]">
					{prayer.canPray && (
						<button
							type="button"
							aria-pressed={prayer.youPrayed}
							onClick={() => void patch(`prayed-${prayer.id}`, { prayed: !prayer.youPrayed })}
							disabled={busy !== null}
							className={prayer.youPrayed ? `${secondaryButton} border-amber-700/40 bg-amber-500/[.12] dark:border-amber-300/40` : secondaryButton}
						>
							<HandHeart size={17} aria-hidden /> {prayer.youPrayed ? "You prayed" : "I prayed"}
						</button>
					)}
					{prayer.canAnswer && !prayer.answered && !answering && (
						<button type="button" onClick={() => setAnswering(true)} className={quietButton}>
							Mark answered
						</button>
					)}
					{prayer.canAnswer && prayer.answered && (
						<button type="button" onClick={() => void patch(`reopen-${prayer.id}`, { answered: false })} disabled={busy !== null} className={quietButton}>
							{busy === `reopen-${prayer.id}` ? "Reopening…" : "Still praying? Reopen"}
						</button>
					)}
				</div>
			)}
			{answering && (
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						if (await patch(`answer-${prayer.id}`, { answered: true, answer })) setAnswering(false);
					}}
					className="mt-3 space-y-2"
				>
					<label className="block">
						<span className="mb-1.5 block text-sm font-bold">
							How was it answered? <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional)</span>
						</span>
						<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={PRAYER_ANSWER_MAX} rows={2} className={`${field} resize-none`} />
					</label>
					<div className="flex flex-wrap gap-2">
						<button type="submit" disabled={busy !== null} className={primaryButton}>
							{busy === `answer-${prayer.id}` ? "Saving…" : "Mark answered"}
						</button>
						<button type="button" onClick={() => setAnswering(false)} className={quietButton}>
							Cancel
						</button>
					</div>
				</form>
			)}
		</article>
	);
}
