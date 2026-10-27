"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Bookmark, BookmarkCheck, Sparkles, Trash2 } from "lucide-react";
import { AddLearnButton } from "@/components/learn/AddLearnButton";
import { formatClock, type PassageComparison } from "@/lib/beta/sermons/sermons-rules";
import type { PassageView, SermonView } from "@/lib/beta/sermons/view-types";
import { CARD, EYEBROW, GOLD_BUTTON, INPUT, MUTED, PAGE, QUIET_BUTTON, SCRIPTURE, SCRIPTURE_TEXT, SERIF, SERMON_TEXT, SERMON_WORDS, TEXT_LINK, FOCUS, readerHref } from "./ui";

type Tab = "passages" | "study" | "transcript" | "research";

const FIT_LABEL: Record<PassageComparison["fit"], string> = {
	close: "Close to the text",
	applies: "Applies the text",
	beyond: "Goes beyond the text",
};

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
	try {
		const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
		const data = (await response.json().catch(() => ({}))) as { error?: string };
		return response.ok ? { ok: true } : { ok: false, error: data.error ?? "Something went wrong. Please try again." };
	} catch {
		return { ok: false, error: "The connection dropped. Please try again." };
	}
}

function Scripture({ label, verses }: { label: string; verses: { n: number; text: string; focus?: boolean }[] }) {
	return (
		<figure className={SCRIPTURE}>
			<figcaption className={EYEBROW}>Scripture · {label} · KJV</figcaption>
			<blockquote className={`mt-1.5 ${SCRIPTURE_TEXT}`}>
				{verses.map((verse) => (
					<span key={verse.n} className={verse.focus === false ? "opacity-60" : undefined}>
						<sup className="mr-0.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.n}</sup>
						{verse.text}{" "}
					</span>
				))}
			</blockquote>
		</figure>
	);
}

function SermonWords({ at, text, label = "The sermon" }: { at: number; text: string; label?: string }) {
	return (
		<figure className={SERMON_WORDS}>
			<figcaption className={EYEBROW}>{label}, at {formatClock(at)}</figcaption>
			<blockquote className={`mt-1.5 ${SERMON_TEXT}`}>&ldquo;{text}&rdquo;</blockquote>
		</figure>
	);
}

function ResearchToggle({ question, marked, onToggle }: { question: string; marked: boolean; onToggle: (question: string, marked: boolean) => void }) {
	return (
		<button
			type="button"
			aria-pressed={marked}
			onClick={() => onToggle(question, !marked)}
			className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${marked ? "text-amber-800 dark:text-[#e5b664]" : "text-neutral-600 dark:text-[#bbb3a7]"} hover:bg-black/[.04] dark:hover:bg-white/[.05] ${FOCUS}`}
		>
			{marked ? <BookmarkCheck size={18} aria-hidden /> : <Bookmark size={18} aria-hidden />}
			{marked ? "Marked to research" : "Research later"}
		</button>
	);
}

function Question({ text, marked, onToggle }: { text: string; marked: boolean; onToggle: (question: string, marked: boolean) => void }) {
	return (
		<li className="flex flex-col gap-1 border-b border-black/[.07] py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4 dark:border-white/[.07]">
			<span className="text-[16px] leading-6">{text}</span>
			<ResearchToggle question={text} marked={marked} onToggle={onToggle} />
		</li>
	);
}

function PassageCard({ passage, sermonId, research, onToggle, onJump }: { passage: PassageView; sermonId: string; research: Set<string>; onToggle: (question: string, marked: boolean) => void; onJump: (at: number) => void }) {
	const router = useRouter();
	const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
	const compare = async () => {
		setState({ busy: true, error: null });
		const result = await send(`/api/beta/sermons/${sermonId}/compare`, "POST", { key: passage.key });
		setState({ busy: false, error: result.ok ? null : (result.error ?? null) });
		if (result.ok) router.refresh();
	};
	const comparison = passage.comparison;
	return (
		<article className={`${CARD} p-5`} aria-labelledby={`passage-${passage.key}`}>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h3 id={`passage-${passage.key}`} className={`${SERIF} text-[26px] font-semibold leading-tight`}>{passage.label}{passage.verse === null ? " (chapter)" : ""}</h3>
				<span className="rounded-full border border-black/10 px-2.5 py-0.5 text-xs font-bold dark:border-white/15">{passage.how === "named" ? "Named in the sermon" : "Quoted in the sermon"}</span>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-x-1">
				<span className={`text-sm ${MUTED}`}>Heard at</span>
				{passage.times.map((time) => (
					<button key={time} type="button" onClick={() => onJump(time)} className={`min-h-11 rounded-lg px-1.5 text-sm font-bold tabular-nums text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`}>
						{formatClock(time)}
					</button>
				))}
			</div>
			<div className="mt-3 grid gap-4 lg:grid-cols-2">
				<Scripture label={passage.label} verses={passage.verses.map((verse) => ({ ...verse, focus: passage.verse === null ? undefined : verse.focus }))} />
				{passage.excerpt && <SermonWords at={passage.times[0] ?? 0} text={passage.excerpt} />}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Link href={readerHref(passage.book, passage.chapter, passage.verse)} className={TEXT_LINK}>
					<BookOpen size={17} aria-hidden /> Read in context
				</Link>
				{!comparison && (
					<button type="button" className={QUIET_BUTTON} disabled={state.busy} onClick={() => void compare()}>
						<Sparkles size={16} aria-hidden /> {state.busy ? "Comparing…" : "Compare with its context"}
					</button>
				)}
			</div>
			{state.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>}
			{comparison && (
				<section aria-label={`How the sermon used ${passage.label}`} className="mt-4 rounded-2xl bg-black/[.03] p-4 dark:bg-white/[.03]">
					<p className={EYEBROW}>SureWord&apos;s comparison · interpretation</p>
					<h4 className="mt-2 text-sm font-bold">In its context</h4>
					<p className="mt-1 text-[15px] leading-6">{comparison.context}</p>
					<h4 className="mt-3 text-sm font-bold">How the sermon used it</h4>
					<p className="mt-1 text-[15px] leading-6">{comparison.sermonUse}</p>
					<p className="mt-3 text-[15px] leading-6">
						<span className="mr-2 rounded-full border border-amber-700/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:border-amber-300/40 dark:text-amber-200">{FIT_LABEL[comparison.fit]}</span>
						{comparison.fitNote}
					</p>
					{comparison.questions.length > 0 && (
						<ul className="mt-2">
							{comparison.questions.map((question) => (
								<Question key={question} text={question} marked={research.has(question)} onToggle={onToggle} />
							))}
						</ul>
					)}
				</section>
			)}
		</article>
	);
}

/** One sermon in Sermon to Study (LC-17643): passages in context, the study, the transcript, and research marks. */
export default function SermonStudyView({ view }: { view: SermonView }) {
	const router = useRouter();
	const [tab, setTab] = useState<Tab>(view.passages.length ? "passages" : "transcript");
	const [research, setResearch] = useState<string[]>(view.research);
	const [studyState, setStudyState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
	const [query, setQuery] = useState("");
	const [jumpTo, setJumpTo] = useState<number | null>(null);
	useEffect(() => setResearch(view.research), [view.research]);
	const marked = useMemo(() => new Set(research), [research]);

	useEffect(() => {
		if (tab !== "transcript" || jumpTo === null) return;
		const segment = view.segments.reduce<number | null>((best, entry, i) => (entry.start <= jumpTo + 0.5 ? i : best), null);
		document.getElementById(`segment-${segment ?? 0}`)?.scrollIntoView({ block: "center" });
	}, [tab, jumpTo, view.segments]);

	const toggle = async (question: string, mark: boolean) => {
		const before = research;
		setResearch(mark ? [...before.filter((entry) => entry !== question), question] : before.filter((entry) => entry !== question));
		const result = await send(`/api/beta/sermons/${view.id}`, "PATCH", { research: { question, marked: mark } });
		if (!result.ok) setResearch(before);
	};

	const writeStudy = async () => {
		setStudyState({ busy: true, error: null });
		const result = await send(`/api/beta/sermons/${view.id}/study`, "POST");
		setStudyState({ busy: false, error: result.ok ? null : (result.error ?? null) });
		if (result.ok) router.refresh();
	};

	const remove = async () => {
		if (!window.confirm(`Delete "${view.title}", its transcript and its study?`)) return;
		const result = await send(`/api/beta/sermons/${view.id}`, "DELETE");
		if (result.ok) {
			router.push("/beta/study/sermons");
			router.refresh();
		}
	};

	const jump = (at: number) => {
		setTab("transcript");
		setQuery("");
		setJumpTo(at);
	};

	const filtered = query.trim()
		? view.segments.map((segment, i) => ({ segment, i })).filter(({ segment }) => segment.text.toLowerCase().includes(query.trim().toLowerCase()))
		: view.segments.map((segment, i) => ({ segment, i }));
	const tabs: { id: Tab; label: string }[] = [
		{ id: "passages", label: `Passages (${view.passages.length})` },
		{ id: "study", label: "Study" },
		{ id: "transcript", label: "Transcript" },
		{ id: "research", label: `Research (${research.length})` },
	];
	const facts = [view.preacher, formatClock(view.durationSec), view.source === "recording" ? "Recorded in SureWord" : view.fileName ?? "Uploaded"].filter(Boolean);

	return (
		<main className={`${PAGE} max-w-4xl`}>
			<Link href="/beta/study/sermons" className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> Sermon to Study
			</Link>
			<header className="mt-2">
				<p className={EYEBROW}>Sermon</p>
				<h1 className={`${SERIF} mt-1 text-[clamp(2.1rem,7.5vw,2.8rem)] font-semibold leading-[1.04]`}>{view.title}</h1>
				<p className={`mt-1 text-[15px] ${MUTED}`}>{facts.join(" · ")}</p>
				<p className={`mt-1 text-xs ${MUTED}`}>Permission to use this recording confirmed {new Date(view.permissionAt).toLocaleDateString()}.</p>
			</header>

			{view.status === "transcribing" ? (
				<section className={`${CARD} mt-6 p-5`}>
					<p className="text-[15px] leading-6">This sermon&apos;s transcription did not finish. Add it again from Sermon to Study, or delete it.</p>
				</section>
			) : (
				<>
					<div role="tablist" aria-label="Sermon sections" className="mt-6 flex gap-1 overflow-x-auto rounded-2xl border border-black/[.09] p-1 dark:border-white/[.09]">
						{tabs.map((entry) => (
							<button
								key={entry.id}
								type="button"
								role="tab"
								aria-selected={tab === entry.id}
								onClick={() => setTab(entry.id)}
								className={`min-h-11 shrink-0 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-bold ${tab === entry.id ? "bg-[#e5b664] text-[#1c2118]" : "text-neutral-700 hover:bg-black/[.04] dark:text-neutral-200 dark:hover:bg-white/[.05]"} ${FOCUS}`}
							>
								{entry.label}
							</button>
						))}
					</div>

					{tab === "passages" && (
						<section aria-label="Passages" className="mt-5 grid gap-4">
							<p className={`text-sm ${MUTED}`}>Every passage the sermon names aloud or quotes in the King James words, in the order it comes up. Scripture is shown on the gold rule; the sermon&apos;s own words on the dashed one.</p>
							{view.passages.length === 0 && <p className="text-[15px]">No passages were found in this sermon.</p>}
							{view.passages.map((passage) => (
								<PassageCard key={passage.key} passage={passage} sermonId={view.id} research={marked} onToggle={toggle} onJump={jump} />
							))}
						</section>
					)}

					{tab === "study" && (
						<section aria-label="Study" className="mt-5">
							{!view.study ? (
								<div className={`${CARD} p-5`}>
									<h2 className={`${SERIF} text-[28px] font-semibold leading-tight`}>Write a study of this sermon</h2>
									<p className={`mt-1 text-[15px] leading-6 ${MUTED}`}>Study notes for each movement of the sermon, discussion questions for a group, and verses worth memorising, written from the transcript and the passages above.</p>
									<button type="button" className={`${GOLD_BUTTON} mt-4`} disabled={studyState.busy} onClick={() => void writeStudy()}>
										<Sparkles size={18} aria-hidden /> {studyState.busy ? "Writing the study…" : "Write the study"}
									</button>
									{studyState.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{studyState.error}</p>}
								</div>
							) : (
								<div className="grid gap-5">
									<div className={`${CARD} p-5`}>
										<p className={EYEBROW}>SureWord&apos;s study of the sermon</p>
										<p className={`${SERIF} mt-2 text-[26px] font-semibold leading-tight`}>{view.study.bigIdea}</p>
										<p className="mt-2 text-[16px] leading-7">{view.study.summary}</p>
									</div>
									{view.study.sections.map((section, i) => (
										<article key={`${section.heading}-${i}`} className={`${CARD} p-5`}>
											<div className="flex items-baseline justify-between gap-3">
												<h3 className={`${SERIF} text-[24px] font-semibold leading-tight`}>{section.heading}</h3>
												<button type="button" onClick={() => jump(section.startSec)} className={`min-h-11 shrink-0 rounded-lg px-1.5 text-sm font-bold tabular-nums text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`}>
													{formatClock(section.startSec)}
												</button>
											</div>
											<div className="mt-3 grid gap-3">
												{section.pastorQuote && <SermonWords at={section.startSec} text={section.pastorQuote} label="The preacher" />}
												{section.scripture && <Scripture label={section.scripture.label} verses={[{ n: section.scripture.verse, text: section.scripture.text }]} />}
											</div>
											<p className="mt-3 text-[16px] leading-7">{section.explanation}</p>
											{section.reflection && <p className={`mt-2 text-[15px] italic leading-6 ${MUTED}`}>Reflect: {section.reflection}</p>}
										</article>
									))}
									{view.study.application && (
										<div className={`${CARD} p-5`}>
											<h3 className={`${SERIF} text-[24px] font-semibold`}>Living it out</h3>
											<p className="mt-2 text-[16px] leading-7">{view.study.application}</p>
										</div>
									)}
									<div className={`${CARD} p-5`}>
										<h3 className={`${SERIF} text-[24px] font-semibold`}>Discussion questions</h3>
										<ul className="mt-1">
											{view.study.questions.map((question) => (
												<Question key={question} text={question} marked={marked.has(question)} onToggle={toggle} />
											))}
										</ul>
									</div>
									{view.study.memory.length > 0 && (
										<div className={`${CARD} p-5`}>
											<h3 className={`${SERIF} text-[24px] font-semibold`}>Verses to memorise</h3>
											<p className={`mt-1 text-sm ${MUTED}`}>Optional. Each goes into Learn a verse with your other memory verses.</p>
											<div className="mt-3 grid gap-4 sm:grid-cols-2">
												{view.study.memory.map((verse) => (
													<div key={verse.key}>
														<Scripture label={verse.label} verses={[{ n: verse.verse, text: verse.text }]} />
														<AddLearnButton book={verse.book} chapter={verse.chapter} verse={verse.verse} translation="KJV" source="suggestion" accessibilityLabel={`Learn ${verse.label}`} />
													</div>
												))}
											</div>
										</div>
									)}
									<p className={`text-xs ${MUTED}`}>Written by SureWord from the transcript ({view.study.model}). Quotes from the preacher are checked word for word against the transcript; Scripture is the KJV text.</p>
								</div>
							)}
						</section>
					)}

					{tab === "transcript" && (
						<section aria-label="Transcript" className="mt-5">
							<label className="block">
								<span className="sr-only">Search the transcript</span>
								<input className={INPUT} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the transcript" />
							</label>
							<p className={`mt-2 text-xs ${MUTED}`}>The sermon&apos;s words as transcribed, which may contain mistakes.</p>
							<ol className="mt-3">
								{filtered.map(({ segment, i }) => (
									<li key={i} id={`segment-${i}`} className="flex gap-3 border-b border-black/[.06] py-2 dark:border-white/[.06]">
										<span className="w-14 shrink-0 pt-0.5 text-right text-sm font-bold tabular-nums text-amber-800 dark:text-[#e5b664]">{formatClock(segment.start)}</span>
										<span className="text-[15px] leading-6">{segment.text}</span>
									</li>
								))}
							</ol>
						</section>
					)}

					{tab === "research" && (
						<section aria-label="Research later" className={`${CARD} mt-5 p-5`}>
							<h2 className={`${SERIF} text-[28px] font-semibold leading-tight`}>Marked for later research</h2>
							<p className={`mt-1 text-sm ${MUTED}`}>Questions you marked from the study and the comparisons. They are saved with the sermon in your Knowledge Vault.</p>
							{research.length === 0 ? (
								<p className="mt-3 text-[15px]">Nothing marked yet. Use &ldquo;Research later&rdquo; on any question.</p>
							) : (
								<ul className="mt-2">
									{research.map((question) => (
										<Question key={question} text={question} marked onToggle={toggle} />
									))}
								</ul>
							)}
						</section>
					)}
				</>
			)}

			<div className="mt-10 flex justify-center">
				<button type="button" className={`${QUIET_BUTTON} text-red-700 dark:text-red-300`} onClick={() => void remove()}>
					<Trash2 size={16} aria-hidden /> Delete this sermon
				</button>
			</div>
		</main>
	);
}
