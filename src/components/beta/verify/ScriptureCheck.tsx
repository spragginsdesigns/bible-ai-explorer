"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { DESTINATION_TILE, IconTile, moduleIcon } from "@/components/beta/visuals";
import {
	PROBLEM_VERDICTS,
	VERDICT_LABELS,
	VERIFY_TEXT_MAX,
	type ReferenceFinding,
	type Verdict,
	type VerifyReport,
} from "@/lib/beta/verify/verify-rules";
import QuotationCard from "./QuotationCard";
import { CARD, EYEBROW, GOLD_BUTTON, MARK_CLASS, MUTED, QUIET_BUTTON, SCRIPTURE, SERIF, TEXT_LINK, VERDICT_CHIP, readerHref } from "./ui";

const VERDICT_ORDER: Verdict[] = ["misquote", "wrong-reference", "not-found", "translation", "minor", "exact"];
/** A text file bigger than this is not a teaching (and would only be cut at the limit). */
const FILE_MAX_BYTES = 1_000_000;

type Filter = "all" | "problems";

async function requestCheck(text: string): Promise<VerifyReport> {
	const response = await fetch("/api/beta/verify/check", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
	});
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok || typeof body !== "object" || body === null || !("report" in body)) {
		const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
		throw new Error(message ?? "The check could not finish. Please try again.");
	}
	return body.report as VerifyReport;
}

function ReferenceRow({ reference }: { reference: ReferenceFinding }) {
	return (
		<li className="border-t border-black/[.07] py-3 first:border-t-0 dark:border-white/[.07]">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<p className="text-[15px] font-bold">
					{reference.label}
					{reference.written !== reference.label ? <span className={`ml-2 text-sm font-normal ${MUTED}`}>written “{reference.written}”</span> : null}
				</p>
				<span className={`text-xs font-bold uppercase tracking-[.12em] ${reference.problem ? "text-rose-800 dark:text-rose-200" : MUTED}`}>
					{reference.problem ? "Not a real reference" : reference.quoted ? "Quoted" : "Named"}
				</span>
			</div>
			{reference.problem ? (
				<p className="mt-1 text-sm text-rose-900 dark:text-rose-200">{reference.problem}</p>
			) : (
				<>
					<p className={`mt-1.5 ${SCRIPTURE} ${SERIF} text-[17px] leading-7 text-neutral-900 dark:text-[#f1eadc]`}>
						{reference.preview.map((verse) => (
							<span key={verse.verse}>
								<sup className="mr-0.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.verse}</sup>
								{verse.text}{" "}
							</span>
						))}
						{reference.verse === null || (reference.endVerse ?? 0) - (reference.verse ?? 0) > 2 ? <span className={MUTED}>…</span> : null}
					</p>
					<Link href={readerHref(reference.book, reference.chapter, reference.verse)} className={TEXT_LINK}>
						<BookOpen size={16} aria-hidden /> Open in the reader
					</Link>
				</>
			)}
		</li>
	);
}

/**
 * Scripture Check (LC-17649, docs/beta/verify.md): paste or upload a teaching
 * and see every marked quotation beside the KJV (or the BSB, when it is
 * closer), word by word, and every reference opened. Deterministic: the
 * bundled text decides, no model is asked.
 */
export default function ScriptureCheck() {
	const [text, setText] = useState("");
	const [report, setReport] = useState<VerifyReport | null>(null);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const fileInput = useRef<HTMLInputElement>(null);
	const resultsHeading = useRef<HTMLHeadingElement>(null);

	async function check(event: React.FormEvent) {
		event.preventDefault();
		if (!text.trim() || checking) return;
		setChecking(true);
		setError(null);
		try {
			const next = await requestCheck(text);
			setReport(next);
			setFilter("all");
			requestAnimationFrame(() => resultsHeading.current?.focus());
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The check could not finish. Please try again.");
		} finally {
			setChecking(false);
		}
	}

	async function upload(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		if (file.size > FILE_MAX_BYTES) {
			setError("That file is too large. Upload a plain-text transcript under 1 MB.");
			return;
		}
		try {
			const content = await file.text();
			setText(content.slice(0, VERIFY_TEXT_MAX));
			setError(content.length > VERIFY_TEXT_MAX ? `Only the first ${VERIFY_TEXT_MAX.toLocaleString("en-US")} characters are checked.` : null);
		} catch {
			setError("That file could not be read. Upload a plain-text file (.txt, .md, .vtt or .srt).");
		}
	}

	const problems = report ? report.quotations.filter((quotation) => PROBLEM_VERDICTS.includes(quotation.verdict)) : [];
	const shown = report ? (filter === "problems" ? problems : report.quotations) : [];
	const badReferences = report ? report.references.filter((reference) => reference.problem).length : 0;

	return (
		<main className="mx-auto w-full max-w-5xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("verify", "study")} tone={DESTINATION_TILE.study} size="lg" />
				<div className="min-w-0">
					<h1 className={`${SERIF} text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]`}>Scripture Check</h1>
					<p className="mt-1.5 max-w-xl text-base leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						Paste a sermon, devotional or AI answer. Every quotation is set beside the KJV word for word, and every reference is opened, so you can see what the Word actually says.
					</p>
				</div>
			</header>

			<form onSubmit={check} className={`${CARD} mt-7 flex flex-col gap-4 p-4 sm:p-5`} aria-labelledby="verify-input-title">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<label id="verify-input-title" htmlFor="verify-text" className={EYEBROW}>
						The teaching
					</label>
					<button type="button" className={QUIET_BUTTON} onClick={() => fileInput.current?.click()} disabled={checking}>
						<FileUp size={16} aria-hidden /> Upload a transcript
					</button>
					<input ref={fileInput} type="file" accept=".txt,.md,.vtt,.srt,text/plain" className="sr-only" tabIndex={-1} aria-hidden onChange={upload} />
				</div>
				<textarea
					id="verify-text"
					value={text}
					onChange={(event) => setText(event.target.value.slice(0, VERIFY_TEXT_MAX))}
					rows={10}
					placeholder={"Paste the text here. Quotations in quotation marks or set apart as a blockquote are checked, with the reference beside them if there is one (John 3:16, 1 Cor. 13:4-7, Psalm xxiii. 1)."}
					className="min-h-[220px] w-full resize-y rounded-2xl border border-black/[.12] bg-white/60 p-4 text-[16px] leading-6 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:border-white/[.14] dark:bg-white/[.04] dark:text-neutral-100 dark:focus-visible:ring-amber-300"
					disabled={checking}
				/>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className={`text-sm ${MUTED}`}>
						{text.length.toLocaleString("en-US")} of {VERIFY_TEXT_MAX.toLocaleString("en-US")} characters
					</p>
					<button type="submit" className={GOLD_BUTTON} disabled={!text.trim() || checking}>
						{checking ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ShieldCheck size={18} aria-hidden />}
						{checking ? "Checking" : "Check against the KJV"}
					</button>
				</div>
				{error ? (
					<p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
						{error}
					</p>
				) : null}
			</form>

			{report ? (
				<section className="mt-8" aria-labelledby="verify-results-title">
					<h2 id="verify-results-title" ref={resultsHeading} tabIndex={-1} className={`${SERIF} text-[2rem] font-semibold leading-tight focus:outline-none`}>
						{report.quotations.length === 0
							? "No quotations to check"
							: problems.length === 0
								? `${report.quotations.length} quotation${report.quotations.length === 1 ? "" : "s"}, none wrong`
								: `${problems.length} of ${report.quotations.length} quotation${report.quotations.length === 1 ? "" : "s"} need${problems.length === 1 ? "s" : ""} attention`}
					</h2>
					<p className={`mt-1 text-[15px] ${MUTED}`}>
						{report.references.length} reference{report.references.length === 1 ? "" : "s"} found
						{badReferences ? `, ${badReferences} not real` : ""}. Checked against the bundled KJV and BSB; a quotation in another translation is shown beside the KJV, not judged.
					</p>

					{report.quotations.length ? (
						<>
							<ul className="mt-4 flex flex-wrap gap-2" aria-label="Verdicts">
								{VERDICT_ORDER.filter((verdict) => report.counts[verdict] > 0).map((verdict) => (
									<li key={verdict} className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-bold ${VERDICT_CHIP[verdict]}`}>
										{report.counts[verdict]} {VERDICT_LABELS[verdict].toLowerCase()}
									</li>
								))}
							</ul>

							<div className="mt-5 flex flex-wrap items-center justify-between gap-3">
								<div className="grid grid-cols-2 gap-1 rounded-2xl border border-black/10 p-1 dark:border-white/10" role="radiogroup" aria-label="Show">
									{(["all", "problems"] as const).map((option) => (
										<button
											key={option}
											type="button"
											role="radio"
											aria-checked={filter === option}
											onClick={() => setFilter(option)}
											className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors ${
												filter === option ? "bg-[#24281f] text-white dark:bg-[#e5b664] dark:text-[#1c2118]" : "text-neutral-700 hover:bg-black/[.04] dark:text-neutral-200 dark:hover:bg-white/[.05]"
											}`}
										>
											{option === "all" ? `All (${report.quotations.length})` : `Needs attention (${problems.length})`}
										</button>
									))}
								</div>
								<p className={`flex flex-wrap gap-x-3 gap-y-1 text-sm ${MUTED}`} aria-label="Marks">
									<span className={MARK_CLASS.changed}>different word</span>
									<span className={MARK_CLASS.missing}>left out</span>
									<span className={MARK_CLASS.minor}>minor</span>
								</p>
							</div>

							<div className="mt-4 flex flex-col gap-4">
								{shown.length ? (
									shown.map((quotation) => <QuotationCard key={quotation.id} quotation={quotation} />)
								) : (
									<p className={`${CARD} p-5 text-[15px] ${MUTED}`}>Every quotation matches the Scripture it gives.</p>
								)}
							</div>
						</>
					) : (
						<p className={`${CARD} mt-4 p-5 text-[15px] ${MUTED}`}>
							Nothing in quotation marks or a blockquote was found. Put the words a teaching quotes in quotation marks to have them checked.
						</p>
					)}

					{report.references.length ? (
						<section className={`${CARD} mt-8 p-4 sm:p-5`} aria-labelledby="verify-references-title">
							<h2 id="verify-references-title" className={EYEBROW}>
								References in the teaching
							</h2>
							<ul className="mt-2">
								{report.references.map((reference, index) => (
									<ReferenceRow key={`${reference.start}-${index}`} reference={reference} />
								))}
							</ul>
						</section>
					) : null}
				</section>
			) : null}
		</main>
	);
}
