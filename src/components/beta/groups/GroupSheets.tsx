"use client";

import { useEffect, useState, type FormEvent } from "react";
import { HandHeart, Loader2 } from "lucide-react";
import type { GroupView } from "@/lib/beta/groups/groups";
import { ErrorNote, Sheet, field, primaryButton, secondaryButton } from "@/components/beta/rooms/room-ui";
import type { GroupAct } from "./GroupScreen";

/** A leader sets the passage the group reads and talks about this week. */
export function SetWeekSheet({ group, act, onClose }: { group: GroupView; act: GroupAct; onClose: () => void }) {
	const [reference, setReference] = useState("");
	const [themes, setThemes] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const plan = group.planWeeks;
	const planWeek = plan?.weeks[plan.current - 1];

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!reference.trim() || sending) return;
		setSending(true);
		setError(null);
		const result = await act("set-week", `/api/beta/groups/${group.room.id}/posts`, { method: "POST", body: { kind: "week", reference, themes } });
		setSending(false);
		if (result.ok) onClose();
		else setError(result.error);
	};

	return (
		<Sheet title="This week's passage" onClose={onClose}>
			<form onSubmit={submit} className="space-y-4">
				<p className="leading-7 text-neutral-700 dark:text-[#d9d1c3]">
					The passage the group reads and talks about this week: one chapter, or verses inside it. Everyone sees it in the King James text.
				</p>
				{plan && planWeek && (
					<div className="rounded-2xl bg-black/[.035] px-4 py-3 dark:bg-white/[.04]">
						<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
							Plan week {planWeek.week} · days {planWeek.firstDay} to {planWeek.lastDay}
						</p>
						<p className="mt-0.5 font-[family-name:var(--font-cormorant)] text-[20px] font-semibold leading-tight">{planWeek.readings}</p>
						{plan.chapters.length > 0 && (
							<>
								<p className="mt-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">Choose a chapter from this week&rsquo;s reading, or type any passage.</p>
								<ul className="mt-2 flex flex-wrap gap-1.5">
									{plan.chapters.map((chapter) => (
										<li key={chapter}>
											<button
												type="button"
												onClick={() => setReference(chapter)}
												aria-pressed={reference === chapter}
												className={`min-h-11 rounded-full border px-3.5 text-sm font-bold ${reference === chapter ? "border-amber-700/40 bg-amber-500/[.12] dark:border-amber-300/40" : "border-black/10 hover:bg-black/[.04] dark:border-white/10 dark:hover:bg-white/[.05]"}`}
											>
												{chapter}
											</button>
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				)}
				<label className="block">
					<span className="mb-1.5 block text-sm font-bold">Passage</span>
					<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} required placeholder="James 1:19-27" className={field} />
				</label>
				<label className="block">
					<span className="mb-1.5 block text-sm font-bold">
						Themes <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional, separated by commas)</span>
					</span>
					<input value={themes} onChange={(event) => setThemes(event.target.value)} maxLength={200} placeholder="anger, listening" className={field} />
				</label>
				{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
				<div className="flex flex-wrap gap-2">
					<button type="submit" disabled={sending || !reference.trim()} className={primaryButton}>
						{sending ? "Setting…" : "Set the passage"}
					</button>
					<button type="button" onClick={onClose} className={secondaryButton}>
						Cancel
					</button>
				</div>
			</form>
		</Sheet>
	);
}

interface PrayerSummary {
	id: string;
	content: string;
}

/**
 * Pick one of your own prayer requests to share. The list comes from the
 * ordinary memories API, which only ever returns the caller's own; nothing is
 * shared until the person confirms, and then only a copy of that one request.
 */
export function SharePrayerSheet({ group, act, onClose, onShared }: { group: GroupView; act: GroupAct; onClose: () => void; onShared: () => void }) {
	const [prayers, setPrayers] = useState<PrayerSummary[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [picked, setPicked] = useState<PrayerSummary | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/memories", { cache: "no-store" })
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error("memories"))))
			.then((data: { memories?: { id: string; content: string; category: string; status: string | null }[] }) => {
				if (cancelled) return;
				setPrayers((data.memories ?? []).filter((memory) => memory.category === "prayer" && memory.status !== "answered" && memory.status !== "closed").map((memory) => ({ id: memory.id, content: memory.content })));
			})
			.catch(() => !cancelled && setLoadError(true));
		return () => {
			cancelled = true;
		};
	}, []);

	const share = async () => {
		if (!picked) return;
		setSending(true);
		setError(null);
		const result = await act("share-prayer", `/api/beta/groups/${group.room.id}/posts`, { method: "POST", body: { kind: "prayer", memoryId: picked.id } });
		setSending(false);
		if (result.ok) onShared();
		else setError(result.error);
	};

	return (
		<Sheet title={picked ? "Share this request?" : "From your prayer list"} onClose={onClose}>
			{picked ? (
				<>
					<p className="rounded-2xl border border-black/10 px-4 py-3 leading-7 [overflow-wrap:anywhere] dark:border-white/10">{picked.content}</p>
					<p className="mt-3 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						Everyone in {group.room.name} will see a copy of this request. It stays on your own prayer list, private as before, and you can remove the copy from the group at any time.
					</p>
					{error && (
						<div className="mt-3">
							<ErrorNote message={error} onDismiss={() => setError(null)} />
						</div>
					)}
					<div className="mt-4 flex flex-wrap gap-2">
						<button type="button" onClick={() => void share()} disabled={sending} className={primaryButton}>
							{sending ? "Sharing…" : "Share a copy"}
						</button>
						<button type="button" onClick={() => setPicked(null)} className={secondaryButton}>
							Pick another
						</button>
					</div>
				</>
			) : (
				<>
					<p className="text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">Only you see this list. Nothing is shared until you choose a request and confirm.</p>
					<div className="mt-3 min-h-24">
						{prayers === null && !loadError && (
							<p className="flex items-center gap-2 py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">
								<Loader2 size={16} className="animate-spin" aria-hidden /> Loading your prayer list…
							</p>
						)}
						{loadError && <ErrorNote message="Could not load your prayer list. Close this and try again." />}
						{prayers !== null && prayers.length === 0 && (
							<p className="py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">Your prayer list has no open requests. Write one for the group directly instead.</p>
						)}
						<ul className="space-y-1">
							{(prayers ?? []).map((prayer) => (
								<li key={prayer.id}>
									<button type="button" onClick={() => setPicked(prayer)} className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.04]">
										<HandHeart size={17} className="mt-1 shrink-0 text-neutral-500" aria-hidden />
										<span className="line-clamp-3 min-w-0 flex-1 leading-6 [overflow-wrap:anywhere]">{prayer.content}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				</>
			)}
		</Sheet>
	);
}
