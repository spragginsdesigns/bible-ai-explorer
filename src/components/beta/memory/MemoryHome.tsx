"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Plus, Search, Sparkles } from "lucide-react";
import {
	MEMORY_PASSAGE_MAX_VERSES,
	MEMORY_SOURCES,
	MEMORY_SOURCE_LABELS,
	type MemoryStatus,
} from "@/lib/beta/memory/memory-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "@/components/beta/visuals";
import {
	addCards,
	fetchCandidates,
	fetchOverview,
	localDay,
	previewReference,
	writeQuestions,
	type MemoryCandidate,
	type MemoryOverview,
	type MemoryPassagePreview,
	type MemoryUnitView,
} from "./memoryClient";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
const heading = "font-[family-name:var(--font-cormorant)] text-[28px] font-semibold leading-tight";
const PRIMARY =
	"inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#24281f] px-5 text-base font-bold text-white transition-opacity disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]";
const SECONDARY =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/15 px-4 text-sm font-bold transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.04]";
const MUTED = "text-neutral-600 dark:text-[#bbb3a7]";

const STATUS_LABEL: Record<MemoryStatus, string> = { due: "Due", learning: "Learning", known: "Known" };
const STATUS_CHIP: Record<MemoryStatus, string> = {
	due: "border-transparent bg-[#e5b664] text-[#1c2118]",
	learning: "border-sky-700/30 bg-sky-500/10 text-sky-900 dark:border-sky-300/30 dark:text-sky-200",
	known: "border-emerald-700/30 bg-emerald-500/10 text-emerald-900 dark:border-emerald-300/30 dark:text-emerald-200",
};

function StatusPill({ status }: { status: MemoryStatus }) {
	return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** Four steps of Learn a verse's ladder, filled to where the verse stands. */
function Steps({ stage }: { stage: number }) {
	return (
		<span className="inline-flex items-center gap-1" aria-label={`Step ${Math.min(stage, 3) + 1} of 4`} role="img">
			{[0, 1, 2, 3].map((step) => (
				<span key={step} className={`h-1.5 w-4 rounded-full ${step <= stage ? "bg-amber-700 dark:bg-[#e5b664]" : "bg-black/10 dark:bg-white/15"}`} />
			))}
		</span>
	);
}

function whenDue(dueAt: string): string {
	const today = localDay(new Date());
	const day = localDay(dueAt);
	if (day <= today) return "Due today";
	const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
	if (days === 1) return "Back tomorrow";
	return `Back in ${days} days`;
}

/**
 * Scripture Memory (LC-17651, docs/beta/memory.md): today's review, making
 * cards from a reference or from the founder's own study with a preview
 * before anything is added, and what they know, are learning and have due,
 * by book and by verse. The cards are Learn a verse's.
 */
export default function MemoryHome({ initial }: { initial: MemoryOverview }) {
	const [overview, setOverview] = useState(initial);
	const [notice, setNotice] = useState<string | null>(null);
	const refresh = () => fetchOverview().then(setOverview).catch(() => undefined);
	const { counts } = overview;
	const Icon = moduleIcon("memory", "learn");

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/learn" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Learn
			</Link>
			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={Icon} tone={DESTINATION_TILE.learn} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Scripture Memory</h1>
					<p className={`mt-1.5 text-base ${MUTED}`}>Make God&apos;s Word stick. The same cards and schedule as Learn a verse, practised five ways.</p>
				</div>
			</header>

			<section aria-labelledby="memory-today" className="mt-6 overflow-hidden rounded-[22px] bg-[#24281f] text-[#f1eadc] dark:border dark:border-white/[.09] dark:bg-white/[.04]">
				<div className="p-5 sm:p-6">
					<h2 id="memory-today" className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Today&apos;s review</h2>
					<p className="mt-2 flex items-baseline gap-2">
						<span className="font-[family-name:var(--font-cormorant)] text-[3.4rem] font-semibold leading-none lining-nums tabular-nums">{overview.dueUnits}</span>
						<span className="text-base font-semibold text-[#d9d1c3]">{overview.dueUnits === 1 ? "card due" : "cards due"}</span>
					</p>
					<p className="mt-2 text-sm text-[#d9d1c3]">
						{counts.verses === 0
							? "Add a verse below to start."
							: overview.dueUnits > 0
								? `${counts.due} ${counts.due === 1 ? "verse" : "verses"} waiting. Each answer moves its schedule in Learn a verse.`
								: overview.nextDueAt
									? `All caught up. ${whenDue(overview.nextDueAt)}.`
									: "All caught up."}
					</p>
					<dl className="mt-5 grid grid-cols-3 gap-2 text-center">
						{([
							["Known", counts.known],
							["Learning", counts.learning],
							["Due", counts.due],
						] as const).map(([label, value]) => (
							<div key={label} className="rounded-2xl bg-white/[.07] px-2 py-3">
								<dt className="text-xs font-bold uppercase tracking-[.14em] text-[#bbb3a7]">{label}</dt>
								<dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					<div className="mt-5 flex flex-wrap items-center gap-3">
						{overview.dueUnits > 0 ? (
							<Link href="/beta/learn/memory/review" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1c2118]">
								Start review <ArrowRight size={18} aria-hidden />
							</Link>
						) : null}
						<Link href="/bible/learn" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[#e5b664] hover:underline">
							<BookOpen size={16} aria-hidden /> Open Learn a verse
						</Link>
					</div>
				</div>
			</section>

			{notice ? (
				<p role="status" className="mt-4 rounded-2xl border border-emerald-700/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold dark:border-emerald-300/25">
					{notice}
				</p>
			) : null}

			<MakeCards
				onAdded={(message) => {
					setNotice(message);
					void refresh();
				}}
			/>

			<YourVerses overview={overview} onChanged={refresh} />
		</main>
	);
}

/* ------------------------------------------------------------------------ */

type QuestionsState = "idle" | "writing" | "done" | "failed";

/** Add the chosen units, then write their questions one at a time when asked. */
async function addAll(
	items: { reference: string; source: "highlight" | "suggestion" | "sheet" }[],
	withQuestions: boolean,
	progress: (line: string) => void,
): Promise<string> {
	let added = 0;
	const units: string[] = [];
	for (const item of items) {
		progress(`Adding ${item.reference}...`);
		const result = await addCards(item.reference, item.source);
		added += result.added;
		units.push(result.reference);
	}
	let written = 0;
	const failed: string[] = [];
	if (withQuestions) {
		for (const reference of units) {
			progress(`Writing questions on ${reference}...`);
			try {
				written += (await writeQuestions(reference)).questions.length;
			} catch {
				failed.push(reference);
			}
		}
	}
	const parts = [`Added ${units.join(", ")}: ${added} new ${added === 1 ? "card" : "cards"}.`];
	if (withQuestions) parts.push(`${written} comprehension ${written === 1 ? "question" : "questions"} written.`);
	if (failed.length) parts.push(`Questions could not be written for ${failed.join(", ")}; try again from the list.`);
	return parts.join(" ");
}

function QuestionsToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
	return (
		<label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#b7832f]" />
			<span>
				<span className="font-bold">Also write comprehension questions</span>
				<span className={`block ${MUTED}`}>AI writes them now, once, and every answer is checked against the verse.</span>
			</span>
		</label>
	);
}

function MakeCards({ onAdded }: { onAdded: (message: string) => void }) {
	const [reference, setReference] = useState("");
	const [preview, setPreview] = useState<MemoryPassagePreview | null>(null);
	const [candidates, setCandidates] = useState<MemoryCandidate[] | null>(null);
	const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
	const [withQuestions, setWithQuestions] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = async (work: () => Promise<void>) => {
		setError(null);
		try {
			await work();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong.");
		} finally {
			setBusy(null);
		}
	};

	const lookUp = () =>
		run(async () => {
			setBusy("Looking it up...");
			setPreview((await previewReference(reference.trim())).passage);
		});

	const findInStudy = () =>
		run(async () => {
			setBusy("Reading your highlights, studies, notes and chats...");
			const { candidates: found } = await fetchCandidates();
			setCandidates(found);
			setChosen(new Set());
		});

	const addPreview = () =>
		run(async () => {
			if (!preview) return;
			onAdded(await addAll([{ reference: preview.reference, source: "sheet" }], withQuestions, setBusy));
			setPreview(null);
			setReference("");
		});

	const addChosen = () =>
		run(async () => {
			const picked = (candidates ?? []).filter((candidate) => chosen.has(candidate.key));
			onAdded(
				await addAll(
					picked.map((candidate) => ({ reference: candidate.reference, source: candidate.source === "highlight" ? "highlight" : "suggestion" })),
					withQuestions,
					setBusy,
				),
			);
			setCandidates((old) => (old ?? []).filter((candidate) => !chosen.has(candidate.key)));
			setChosen(new Set());
		});

	const groups = MEMORY_SOURCES.map((source) => ({ source, items: (candidates ?? []).filter((candidate) => candidate.source === source) })).filter(
		(group) => group.items.length > 0,
	);

	return (
		<section aria-labelledby="memory-make" className={`${card} mt-6 p-5 sm:p-6`}>
			<h2 id="memory-make" className={heading}>Make cards</h2>
			<p className={`mt-1 text-sm leading-6 ${MUTED}`}>
				A card is one verse or a passage of up to {MEMORY_PASSAGE_MAX_VERSES} verses. Nothing is added until you see it and choose it.
			</p>

			<form
				className="mt-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (reference.trim() && !busy) void lookUp();
				}}
			>
				<label htmlFor="memory-reference" className="text-sm font-bold">Add a verse or passage</label>
				<div className="mt-2 flex items-center gap-2 rounded-2xl border border-black/10 bg-white/80 py-1.5 pl-4 pr-1.5 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
					<input
						id="memory-reference"
						value={reference}
						onChange={(event) => {
							setReference(event.target.value);
							setPreview(null);
						}}
						placeholder="Ephesians 2:8-9"
						autoComplete="off"
						maxLength={80}
						className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
					/>
					<button type="submit" disabled={!reference.trim() || Boolean(busy)} aria-label="Look up" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#24281f] text-white transition-opacity disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]">
						<Search size={18} aria-hidden />
					</button>
				</div>
			</form>

			{preview ? (
				<div className="mt-4 rounded-2xl border border-amber-700/25 bg-amber-500/[.06] p-4 dark:border-amber-300/20">
					<p className="text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-[#e5b664]">
						{preview.reference} · {preview.translation}
					</p>
					<blockquote className="mt-2 font-[family-name:var(--font-cormorant)] text-[1.35rem] leading-snug">
						{preview.verses.map((verse) => (
							<span key={verse.verse}>
								{preview.verses.length > 1 ? <sup className="mr-0.5 font-sans text-[0.6em] font-bold text-neutral-500">{verse.verse}</sup> : null}
								{verse.text}{" "}
							</span>
						))}
					</blockquote>
					{preview.verses.some((verse) => verse.inDeck) ? (
						<p className={`mt-2 text-sm ${MUTED}`}>
							Already in your cards: {preview.verses.filter((verse) => verse.inDeck).map((verse) => `verse ${verse.verse}`).join(", ")}. Their schedule stays as it is.
						</p>
					) : null}
					<div className="mt-3">
						<QuestionsToggle checked={withQuestions} onChange={setWithQuestions} />
					</div>
					<button type="button" onClick={() => void addPreview()} disabled={Boolean(busy)} className={`${PRIMARY} mt-3 w-full sm:w-auto`}>
						<Plus size={18} aria-hidden /> Add to my cards
					</button>
				</div>
			) : null}

			<div className="mt-5 border-t border-black/[.07] pt-5 dark:border-white/[.07]">
				<p className="text-sm font-bold">Or make them from your own study</p>
				<p className={`mt-1 text-sm leading-6 ${MUTED}`}>Your highlights, saved studies, notes, SureWord Beta work and recent chats, with the verses already in your cards left out.</p>
				<button type="button" onClick={() => void findInStudy()} disabled={Boolean(busy)} className={`${SECONDARY} mt-3`}>
					<Sparkles size={16} aria-hidden /> {candidates ? "Look again" : "Find verses in my study"}
				</button>
			</div>

			{candidates && candidates.length === 0 ? (
				<p className={`mt-4 text-sm ${MUTED}`}>Nothing new found. Highlight a verse, or write a reference into a note, and it will show up here.</p>
			) : null}

			{groups.length > 0 ? (
				<div className="mt-4 space-y-5">
					{groups.map(({ source, items }) => (
						<fieldset key={source}>
							<legend className={eyebrow}>{MEMORY_SOURCE_LABELS[source]}</legend>
							<ul className="mt-2 space-y-2">
								{items.map((candidate) => {
									const selected = chosen.has(candidate.key);
									return (
										<li key={candidate.key}>
											<label
												className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors ${
													selected
														? "border-amber-700/50 bg-amber-500/10 dark:border-amber-300/40"
														: "border-black/[.08] bg-white/50 hover:border-amber-700/30 dark:border-white/[.08] dark:bg-white/[.02]"
												}`}
											>
												<input
													type="checkbox"
													checked={selected}
													onChange={() =>
														setChosen((old) => {
															const next = new Set(old);
															if (next.has(candidate.key)) next.delete(candidate.key);
															else next.add(candidate.key);
															return next;
														})
													}
													className="mt-1 h-5 w-5 shrink-0 accent-[#b7832f]"
												/>
												<span className="min-w-0">
													<span className="block text-sm font-bold">{candidate.reference}</span>
													<span className="mt-0.5 block font-[family-name:var(--font-cormorant)] text-lg leading-snug">{candidate.text}</span>
													<span className={`mt-1 block text-xs ${MUTED}`}>{candidate.reason}</span>
												</span>
											</label>
										</li>
									);
								})}
							</ul>
						</fieldset>
					))}
					<QuestionsToggle checked={withQuestions} onChange={setWithQuestions} />
					<button type="button" onClick={() => void addChosen()} disabled={chosen.size === 0 || Boolean(busy)} className={`${PRIMARY} w-full sm:w-auto`}>
						<Plus size={18} aria-hidden /> {chosen.size === 0 ? "Choose cards to add" : `Add ${chosen.size} ${chosen.size === 1 ? "card" : "cards"}`}
					</button>
				</div>
			) : null}

			{busy ? <p role="status" className="mt-4 text-sm font-bold">{busy}</p> : null}
			{error ? <p role="alert" className="mt-4 text-sm font-bold text-rose-700 dark:text-rose-300">{error}</p> : null}
		</section>
	);
}

/* ------------------------------------------------------------------------ */

function UnitRow({ unit, onChanged }: { unit: MemoryUnitView; onChanged: () => void }) {
	const [state, setState] = useState<QuestionsState>("idle");
	const write = async () => {
		setState("writing");
		try {
			await writeQuestions(unit.reference);
			setState("done");
			onChanged();
		} catch {
			setState("failed");
		}
	};
	return (
		<li className="rounded-2xl border border-black/[.07] bg-white/50 px-4 py-3 dark:border-white/[.07] dark:bg-white/[.02]">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<span className="font-bold">{unit.reference}</span>
				<StatusPill status={unit.status} />
				<Steps stage={unit.stage} />
				<span className={`ml-auto text-sm ${MUTED}`}>{whenDue(unit.nextDueAt)}</span>
			</div>
			{unit.passage ? (
				<ul className={`mt-2 space-y-1 text-sm ${MUTED}`} aria-label={`Verses of ${unit.reference}`}>
					{unit.verses.map((verse) => (
						<li key={verse.id} className="flex flex-wrap items-center gap-x-3">
							<span className="w-16 font-semibold">Verse {verse.verse}</span>
							<span>{STATUS_LABEL[verse.status]}</span>
							<span>· step {Math.min(verse.stage, 3) + 1} of 4</span>
							<span>· {whenDue(verse.dueAt).toLowerCase()}</span>
						</li>
					))}
				</ul>
			) : null}
			<div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm">
				<span className={MUTED}>
					{unit.questions > 0 ? `${unit.questions} comprehension ${unit.questions === 1 ? "question" : "questions"}` : "No comprehension questions yet"}
				</span>
				{unit.questions === 0 || state === "failed" ? (
					<button type="button" onClick={() => void write()} disabled={state === "writing"} className="min-h-11 font-bold text-amber-800 hover:underline disabled:opacity-50 dark:text-[#e5b664]">
						{state === "writing" ? "Writing..." : state === "failed" ? "Could not write them. Try again" : "Write questions"}
					</button>
				) : null}
			</div>
		</li>
	);
}

function YourVerses({ overview, onChanged }: { overview: MemoryOverview; onChanged: () => void }) {
	const { counts } = overview;
	if (counts.verses === 0) {
		return (
			<section aria-labelledby="memory-verses" className="mt-8">
				<h2 id="memory-verses" className={heading}>What you know</h2>
				<p className={`mt-2 text-sm ${MUTED}`}>Your verses will be listed here by book, with what you know, what you are learning and what is due.</p>
			</section>
		);
	}
	const share = (value: number) => `${(value / counts.verses) * 100}%`;
	return (
		<section aria-labelledby="memory-verses" className="mt-8">
			<h2 id="memory-verses" className={heading}>What you know</h2>
			<p className={`mt-1 text-sm ${MUTED}`}>
				{counts.verses} {counts.verses === 1 ? "verse" : "verses"}: {counts.known} known, {counts.learning} learning, {counts.due} due today. Known means it has held for sixteen days.
			</p>
			<div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]" role="img" aria-label={`${counts.known} known, ${counts.learning} learning`}>
				<span className="h-full bg-emerald-600 dark:bg-emerald-400" style={{ width: share(counts.known) }} />
				<span className="h-full bg-sky-600/70 dark:bg-sky-400/70" style={{ width: share(counts.learning) }} />
			</div>
			<div className="mt-4 space-y-3">
				{overview.books.map((book) => (
					<details key={book.book} open={overview.books.length <= 3} className={`${card} group`}>
						<summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
							<span className="font-[family-name:var(--font-cormorant)] text-[22px] font-semibold">{book.name}</span>
							<span className={`text-sm ${MUTED}`}>
								{book.verses} {book.verses === 1 ? "verse" : "verses"}
							</span>
							<span className="ml-auto flex flex-wrap justify-end gap-1.5 text-xs font-bold">
								{book.due > 0 ? <span className={`rounded-full border px-2 py-0.5 ${STATUS_CHIP.due}`}>{book.due} due</span> : null}
								{book.known > 0 ? <span className={`rounded-full border px-2 py-0.5 ${STATUS_CHIP.known}`}>{book.known} known</span> : null}
								{book.learning > 0 ? <span className={`rounded-full border px-2 py-0.5 ${STATUS_CHIP.learning}`}>{book.learning} learning</span> : null}
							</span>
						</summary>
						<ul className="space-y-2 px-3 pb-3">
							{book.units.map((unit) => (
								<UnitRow key={unit.key} unit={unit} onChanged={onChanged} />
							))}
						</ul>
					</details>
				))}
			</div>
		</section>
	);
}
