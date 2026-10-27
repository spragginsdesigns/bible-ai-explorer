"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, BellRing, Loader2, Plus } from "lucide-react";
import { PRAYER_REQUEST_MAX } from "@/lib/beta/prayer/prayer-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import { ErrorNote, card, cardTitle, eyebrow, field, goldButton, muted, quietButton } from "../growth/ui";
import { prayerApi, type PrayerOverview } from "./prayerApi";
import PrayerRequestCard from "./PrayerRequestCard";
import TestimonyTimeline from "./TestimonyTimeline";

/**
 * Prayer & Testimony (LC-17723, docs/beta/prayer.md). The founder's own prayer
 * list, each request a living entry, beside the testimony timeline it becomes.
 */
export default function PrayerScreen() {
	const { userId } = useAuth();
	// A different account must never see the previous one's prayers, even briefly.
	return <PrayerContent key={userId ?? "guest"} />;
}

function PrayerContent() {
	const [overview, setOverview] = useState<PrayerOverview | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);
	const sequence = useRef(0);

	const load = useCallback(async () => {
		const ticket = ++sequence.current;
		try {
			const next = await prayerApi.overview();
			if (ticket !== sequence.current) return;
			setOverview(next);
			setLoadError(null);
		} catch (failure) {
			if (ticket !== sequence.current) return;
			setLoadError(failure instanceof Error ? failure.message : "Could not load your prayers. Please try again.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const addRequest = async () => {
		const content = draft.trim();
		if (!content) return;
		setAdding(true);
		setAddError(null);
		try {
			const created = await prayerApi.addRequest(content);
			setDraft("");
			await load();
			setOpenId(created.id);
		} catch (failure) {
			setAddError(failure instanceof Error ? failure.message : "That did not save. Please try again.");
		} finally {
			setAdding(false);
		}
	};

	const requests = overview?.requests ?? [];
	const open = requests.filter((request) => request.onList && request.status === "open");
	const settled = requests.filter((request) => !(request.onList && request.status === "open"));
	const due = open.filter((request) => request.due);

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/learn" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Learn
			</Link>
			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("prayer", "learn")} tone={DESTINATION_TILE.learn} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Prayer &amp; Testimony</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">What you prayed, what happened, and what you learned</p>
				</div>
			</header>

			{loadError && !overview && (
				<div className="mt-6 space-y-3">
					<ErrorNote message={loadError} />
					<button type="button" onClick={() => void load()} className={quietButton}>
						Try again
					</button>
				</div>
			)}

			{!overview && !loadError && (
				<div className="mt-6 grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading your prayers">
					{[0, 1].map((key) => (
						<div key={key} className={`${card} h-64 animate-pulse`} />
					))}
				</div>
			)}

			{overview && (
				<div className="mt-6 grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
					<div className="flex min-w-0 flex-col gap-5">
						{due.length > 0 && (
							<section className={`${card} px-5 py-5`} aria-labelledby="prayer-due">
								<p id="prayer-due" className={`${eyebrow} flex items-center gap-2`}>
									<BellRing size={14} aria-hidden /> To revisit today
								</p>
								<ul className="mt-3 space-y-2">
									{due.map((request) => (
										<li key={request.id}>
											<button type="button" onClick={() => setOpenId(request.id)} className="flex min-h-11 w-full items-center rounded-2xl px-3 py-2 text-left leading-6 hover:bg-black/[.04] [overflow-wrap:anywhere] dark:hover:bg-white/[.04]">
												<span className="line-clamp-2">{request.request}</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						)}

						<section className={`${card} px-5 py-5`} aria-labelledby="prayer-list">
							<p className={eyebrow}>Private to you</p>
							<h2 id="prayer-list" className={`${cardTitle} mt-1`}>Your prayer list</h2>
							<form
								className="mt-4"
								onSubmit={(event) => {
									event.preventDefault();
									void addRequest();
								}}
							>
								<label htmlFor="prayer-new" className="sr-only">A new prayer request</label>
								<textarea
									id="prayer-new"
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									maxLength={PRAYER_REQUEST_MAX}
									rows={2}
									placeholder="What would you like to pray about?"
									className={`${field} resize-y leading-7`}
								/>
								{addError && (
									<div className="mt-2">
										<ErrorNote message={addError} onDismiss={() => setAddError(null)} />
									</div>
								)}
								<button type="submit" disabled={adding || !draft.trim()} className={`${goldButton} mt-3`}>
									{adding ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />} Add to my prayer list
								</button>
							</form>

							{requests.length === 0 && (
								<p className={`mt-5 leading-7 ${muted}`}>
									Your prayer list is empty. Requests you add here, or ask SureWord to remember in a conversation, appear here, and each one gathers its updates, passages and what God did.
								</p>
							)}

							{open.length > 0 && (
								<ul className="mt-5 space-y-3" aria-label="Open requests">
									{open.map((request) => (
										<PrayerRequestCard key={request.id} request={request} today={overview.today} expanded={openId === request.id} onToggle={() => setOpenId(openId === request.id ? null : request.id)} onChanged={load} />
									))}
								</ul>
							)}

							{settled.length > 0 && (
								<>
									<p className={`${eyebrow} mt-6`}>Answered and laid down</p>
									<ul className="mt-3 space-y-3" aria-label="Answered and laid down">
										{settled.map((request) => (
											<PrayerRequestCard key={request.id} request={request} today={overview.today} expanded={openId === request.id} onToggle={() => setOpenId(openId === request.id ? null : request.id)} onChanged={load} />
										))}
									</ul>
								</>
							)}
						</section>
					</div>

					<TestimonyTimeline
						months={overview.timeline}
						onOpen={(id) => {
							setOpenId(id);
							window.setTimeout(() => document.getElementById(`prayer-${id}`)?.scrollIntoView({ block: "center" }), 50);
						}}
					/>
				</div>
			)}
		</main>
	);
}
