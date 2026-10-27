"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, BookOpen, ChevronDown, Loader2, Share2, Trash2, Users, X } from "lucide-react";
import { PRAYER_REFLECTION_MAX, PRAYER_UPDATE_MAX, PRAYER_WORDS_MAX, type OutcomeKind } from "@/lib/beta/prayer/prayer-rules";
import { ErrorNote, eyebrow, field, goldButton, muted, quietButton, textButton } from "../growth/ui";
import { dayLabel, prayerApi, shortDate, type GroupChoice, type PrayerRequestView } from "./prayerApi";

const row = "rounded-2xl border border-black/[.08] dark:border-white/[.08]";

function statusLine(request: PrayerRequestView): string {
	if (!request.onList) return "No longer on your prayer list. Its testimony is kept here.";
	if (request.outcome?.kind === "answered") return `Answered · recorded ${shortDate(request.outcome.at)}`;
	if (request.outcome?.kind === "closed") return `Laid down · ${shortDate(request.outcome.at)}`;
	if (request.status === "answered") return "Marked answered in a conversation";
	if (request.status === "closed") return "Laid down in a conversation";
	return `Praying since ${shortDate(request.askedAt)}`;
}

/**
 * One request as a living entry. Collapsed it is the request and where it
 * stands; open it gathers dated updates, linked passages, a reminder, the
 * outcome the founder confirms in their own words, and sharing on purpose.
 */
export default function PrayerRequestCard({
	request,
	today,
	expanded,
	onToggle,
	onChanged,
}: {
	request: PrayerRequestView;
	today: string;
	expanded: boolean;
	onToggle: () => void;
	onChanged: () => Promise<void>;
}) {
	const detailId = `prayer-${request.id}`;
	return (
		<li className={`${row} ${request.due ? "border-[#e5b664]/60 dark:border-[#e5b664]/40" : ""}`}>
			<button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailId} className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left">
				<span className="min-w-0 flex-1">
					<span className="block leading-7 [overflow-wrap:anywhere]">{request.request}</span>
					<span className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-sm ${muted}`}>
						{statusLine(request)}
						{request.due && (
							<span className="inline-flex items-center gap-1 font-bold text-amber-800 dark:text-[#e5b664]">
								<BellRing size={13} aria-hidden /> Revisit today
							</span>
						)}
					</span>
				</span>
				<ChevronDown size={18} aria-hidden className={`mt-1.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
			</button>
			{expanded && (
				<div id={detailId} className="border-t border-black/[.08] px-4 pb-4 pt-3 dark:border-white/[.08]">
					<RequestDetail request={request} today={today} onChanged={onChanged} />
				</div>
			)}
		</li>
	);
}

function RequestDetail({ request, today, onChanged }: { request: PrayerRequestView; today: string; onChanged: () => Promise<void> }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [update, setUpdate] = useState("");
	const [passage, setPassage] = useState("");
	const [remindOn, setRemindOn] = useState(request.remindOn ?? "");
	// An update on the reminder day clears it on the server; the day picker follows.
	useEffect(() => setRemindOn(request.remindOn ?? ""), [request.remindOn]);

	/** Runs one save and reloads; true when it saved. */
	const run = async (action: () => Promise<unknown>): Promise<boolean> => {
		setBusy(true);
		setError(null);
		try {
			await action();
			await onChanged();
			return true;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "That did not save. Please try again.");
			return false;
		} finally {
			setBusy(false);
		}
	};

	const editable = request.onList;
	const open = editable && request.status === "open";

	return (
		<div className="space-y-5">
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}

			<section aria-label="Updates">
				<p className={eyebrow}>Updates</p>
				{request.updates.length === 0 ? (
					<p className={`mt-2 text-sm leading-6 ${muted}`}>No updates yet. Add one whenever there is news, or when you pray about it again.</p>
				) : (
					<ol className="mt-2 space-y-2">
						{request.updates.map((entry) => (
							<li key={entry.id} className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className={`text-xs font-bold ${muted}`}>{shortDate(entry.at)}</p>
									<p className="whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{entry.text}</p>
								</div>
								{editable && (
									<button type="button" disabled={busy} onClick={() => window.confirm("Delete this update?") && void run(() => prayerApi.removeUpdate(request.id, entry.id))} className={`${textButton} shrink-0 text-neutral-600 dark:text-[#bbb3a7]`} aria-label={`Delete the update from ${shortDate(entry.at)}`}>
										<Trash2 size={16} aria-hidden />
									</button>
								)}
							</li>
						))}
					</ol>
				)}
				{editable && (
					<form
						className="mt-3"
						onSubmit={(event) => {
							event.preventDefault();
							const text = update.trim();
							if (text) void run(() => prayerApi.addUpdate(request.id, text)).then((saved) => saved && setUpdate(""));
						}}
					>
						<label htmlFor={`update-${request.id}`} className="sr-only">An update on this prayer</label>
						<textarea id={`update-${request.id}`} value={update} onChange={(event) => setUpdate(event.target.value)} maxLength={PRAYER_UPDATE_MAX} rows={2} placeholder="What has happened, or how are you praying now?" className={`${field} resize-y leading-7`} />
						<button type="submit" disabled={busy || !update.trim()} className={`${quietButton} mt-2`}>
							{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null} Add update
						</button>
					</form>
				)}
			</section>

			<section aria-label="Passages">
				<p className={eyebrow}>Standing on</p>
				{request.passageLinks.length > 0 ? (
					<ul className="mt-2 flex flex-wrap gap-2">
						{request.passageLinks.map(({ label, href }) => (
							<li key={label} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-black/10 pl-3 pr-1 text-sm font-semibold dark:border-white/15">
								<Link href={href} prefetch={false} className="inline-flex items-center gap-1.5 hover:underline">
									<BookOpen size={14} aria-hidden /> {label}
								</Link>
								{editable && (
									<button type="button" disabled={busy} onClick={() => void run(() => prayerApi.setDetails(request.id, { passages: request.passages.filter((item) => item !== label) }))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/[.05] dark:hover:bg-white/[.06]" aria-label={`Remove ${label}`}>
										<X size={14} aria-hidden />
									</button>
								)}
							</li>
						))}
					</ul>
				) : (
					<p className={`mt-2 text-sm leading-6 ${muted}`}>No passages linked yet.</p>
				)}
				{editable && (
					<form
						className="mt-2 flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							const label = passage.trim();
							if (label) void run(() => prayerApi.setDetails(request.id, { passages: [...request.passages, label] })).then((saved) => saved && setPassage(""));
						}}
					>
						<label htmlFor={`passage-${request.id}`} className="sr-only">A passage to link</label>
						<input id={`passage-${request.id}`} value={passage} onChange={(event) => setPassage(event.target.value)} maxLength={60} placeholder="Philippians 4:6" className={`${field} min-w-0 flex-1`} />
						<button type="submit" disabled={busy || !passage.trim()} className={quietButton}>
							Link
						</button>
					</form>
				)}
			</section>

			{open && (
				<section aria-label="Reminder">
					<p className={eyebrow}>Reminder</p>
					<p className={`mt-1 text-sm leading-6 ${muted}`}>
						{request.remindOn ? `SureWord will bring this back on ${dayLabel(request.remindOn)}, here on this page.` : "Choose a day to come back to this prayer. It shows here; there is no push."}
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<label htmlFor={`remind-${request.id}`} className="sr-only">Reminder day</label>
						<input id={`remind-${request.id}`} type="date" min={today} value={remindOn} onChange={(event) => setRemindOn(event.target.value)} className={`${field} w-auto min-h-11`} />
						<button type="button" disabled={busy || !remindOn || remindOn === request.remindOn} onClick={() => void run(() => prayerApi.setDetails(request.id, { remindOn }))} className={quietButton}>
							Remind me
						</button>
						{request.remindOn && (
							<button type="button" disabled={busy} onClick={() => void run(() => prayerApi.setDetails(request.id, { remindOn: null }))} className={textButton}>
								Clear
							</button>
						)}
					</div>
				</section>
			)}

			{editable && <OutcomeSection request={request} busy={busy} run={run} />}

			{open && <ShareSection request={request} />}

			{!editable && (
				<button type="button" disabled={busy} onClick={() => window.confirm("Remove this prayer's updates, passages and outcome from your timeline?") && void run(() => prayerApi.forget(request.id))} className={quietButton}>
					<Trash2 size={16} aria-hidden /> Remove from my timeline
				</button>
			)}
		</div>
	);
}

/**
 * An outcome is recorded only when the founder confirms it, in their own
 * words: write what happened, review it, then confirm.
 */
function OutcomeSection({ request, busy, run }: { request: PrayerRequestView; busy: boolean; run: (action: () => Promise<unknown>) => Promise<boolean> }) {
	const [writing, setWriting] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [kind, setKind] = useState<OutcomeKind>(request.status === "closed" ? "closed" : "answered");
	const [words, setWords] = useState("");
	const [reflection, setReflection] = useState("");

	if (request.outcome) {
		return (
			<section aria-label="Outcome">
				<p className={eyebrow}>{request.outcome.kind === "answered" ? "What God did" : "Laid down"}</p>
				<p className="mt-2 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{request.outcome.words}</p>
				{request.outcome.reflection && (
					<p className={`mt-2 whitespace-pre-line border-l-2 border-[#e5b664] pl-3 italic leading-7 [overflow-wrap:anywhere] ${muted}`}>{request.outcome.reflection}</p>
				)}
				<button type="button" disabled={busy} onClick={() => window.confirm("Pray on? The request opens again, and what you wrote becomes an update.") && void run(() => prayerApi.reopen(request.id))} className={`${textButton} mt-2`}>
					Pray on
				</button>
			</section>
		);
	}

	if (!writing) {
		return (
			<section aria-label="Outcome">
				{request.status !== "open" && (
					<p className={`mb-2 text-sm leading-6 ${muted}`}>Nothing is recorded until you write what happened in your own words.</p>
				)}
				<button type="button" onClick={() => setWriting(true)} className={quietButton}>
					Record what happened
				</button>
			</section>
		);
	}

	if (reviewing) {
		return (
			<section aria-label="Confirm the outcome" className="rounded-2xl border border-[#e5b664]/50 px-4 py-4">
				<p className="font-bold">{kind === "answered" ? "Record this prayer as answered?" : "Record this prayer as laid down?"}</p>
				<p className="mt-2 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{words.trim()}</p>
				{reflection.trim() && <p className={`mt-2 whitespace-pre-line border-l-2 border-[#e5b664] pl-3 italic leading-7 [overflow-wrap:anywhere] ${muted}`}>{reflection.trim()}</p>}
				<p className={`mt-2 text-sm leading-6 ${muted}`}>It moves to your testimony timeline, and SureWord stops asking about it in conversations. You can pray on at any time.</p>
				<div className="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() => void run(() => prayerApi.recordOutcome(request.id, { kind, words: words.trim(), reflection: reflection.trim() || null }))}
						className={goldButton}
					>
						{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null} Confirm
					</button>
					<button type="button" disabled={busy} onClick={() => setReviewing(false)} className={quietButton}>
						Edit
					</button>
				</div>
			</section>
		);
	}

	return (
		<section aria-label="Record what happened">
			<fieldset>
				<legend className={eyebrow}>What happened</legend>
				<div className="mt-2 flex flex-wrap gap-2">
					{(["answered", "closed"] as const).map((choice) => (
						<label key={choice} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-bold ${kind === choice ? "border-[#e5b664] bg-[#e5b664]/15" : "border-black/10 dark:border-white/15"}`}>
							<input type="radio" name={`kind-${request.id}`} value={choice} checked={kind === choice} onChange={() => setKind(choice)} className="sr-only" />
							{choice === "answered" ? "God answered it" : "I laid it down"}
						</label>
					))}
				</div>
			</fieldset>
			<label htmlFor={`words-${request.id}`} className={`mt-3 block text-sm font-bold`}>In your own words</label>
			<textarea id={`words-${request.id}`} value={words} onChange={(event) => setWords(event.target.value)} maxLength={PRAYER_WORDS_MAX} rows={3} placeholder="What happened?" className={`${field} mt-1 resize-y leading-7`} />
			<label htmlFor={`reflection-${request.id}`} className="mt-3 block text-sm font-bold">
				Reflection <span className={`font-normal ${muted}`}>(optional)</span>
			</label>
			<textarea id={`reflection-${request.id}`} value={reflection} onChange={(event) => setReflection(event.target.value)} maxLength={PRAYER_REFLECTION_MAX} rows={2} placeholder="What did you learn, or how did it shape you?" className={`${field} mt-1 resize-y leading-7`} />
			<div className="mt-3 flex flex-wrap gap-2">
				<button type="button" disabled={!words.trim()} onClick={() => setReviewing(true)} className={goldButton}>
					Review
				</button>
				<button type="button" onClick={() => setWriting(false)} className={quietButton}>
					Cancel
				</button>
			</div>
		</section>
	);
}

/**
 * Sharing on purpose, the Groups prayer circle's own way: pick a group, see
 * exactly what goes, confirm, and only then a copy of this one request is
 * posted through the circle's route. The request stays private here.
 */
function ShareSection({ request }: { request: PrayerRequestView }) {
	const [groups, setGroups] = useState<GroupChoice[] | null>(null);
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState<GroupChoice | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [shared, setShared] = useState<string | null>(null);

	const start = async () => {
		setPicking(true);
		setError(null);
		setShared(null);
		try {
			setGroups((await prayerApi.groups()).groups.filter((group) => !group.archived));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Could not load your groups.");
		}
	};

	const share = async () => {
		if (!picked) return;
		setSending(true);
		setError(null);
		try {
			await prayerApi.shareToGroup(picked.id, request.id);
			setShared(picked.name);
			setPicked(null);
			setPicking(false);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "That did not share. Please try again.");
		} finally {
			setSending(false);
		}
	};

	return (
		<section aria-label="Share">
			{shared && <p className="mb-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]" role="status">A copy is in {shared}&apos;s prayer circle.</p>}
			{error && (
				<div className="mb-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
			{!picking ? (
				<button type="button" onClick={() => void start()} className={quietButton}>
					<Share2 size={16} aria-hidden /> Share into a group
				</button>
			) : picked ? (
				<div className="rounded-2xl border border-black/10 px-4 py-4 dark:border-white/15">
					<p className="font-bold">Share this request with {picked.name}?</p>
					<p className="mt-2 leading-7 [overflow-wrap:anywhere]">{request.request}</p>
					<p className={`mt-2 text-sm leading-6 ${muted}`}>
						Everyone in {picked.name} will see a copy of this request. It stays on your own prayer list, private as before, and your updates, passages and outcome stay here. You can remove the copy from the group at any time.
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<button type="button" disabled={sending} onClick={() => void share()} className={goldButton}>
							{sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null} Share a copy
						</button>
						<button type="button" disabled={sending} onClick={() => setPicked(null)} className={quietButton}>
							Back
						</button>
					</div>
				</div>
			) : (
				<div className="rounded-2xl border border-black/10 px-2 py-2 dark:border-white/15">
					<div className="flex items-center justify-between px-2">
						<p className={eyebrow}>Your groups</p>
						<button type="button" onClick={() => setPicking(false)} className={textButton}>
							Cancel
						</button>
					</div>
					{groups === null && !error && (
						<p className={`flex items-center gap-2 px-2 py-3 text-sm ${muted}`}>
							<Loader2 size={16} className="animate-spin" aria-hidden /> Loading your groups…
						</p>
					)}
					{groups !== null && groups.length === 0 && (
						<p className={`px-2 py-3 text-sm leading-6 ${muted}`}>
							You are not in a group yet. <Link href="/beta/together/groups" className="font-bold underline">Start or join one</Link> to share prayers with it.
						</p>
					)}
					<ul>
						{(groups ?? []).map((group) => (
							<li key={group.id}>
								<button type="button" onClick={() => setPicked(group)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/[.04] dark:hover:bg-white/[.04]">
									<Users size={16} aria-hidden className="shrink-0" />
									<span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
