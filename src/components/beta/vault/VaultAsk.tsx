"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUp, LoaderCircle, Sparkles } from "lucide-react";
import { aiConsentGate, CONSENT_DECLINED_NOTICE } from "@/lib/ai-consent-gate";
import type { AskResult } from "@/lib/beta/vault/ask";
import VaultEntryCard from "./VaultEntryCard";
import { card, eyebrow, muted, tapChip, vaultFetch } from "./vaultUi";

const EXAMPLES = [
	"What have I studied about the Holy Spirit over the last six months?",
	"What have I learned about grace?",
	"What did I study last month?",
];

type State = { status: "idle" } | { status: "asking"; question: string } | { status: "error"; message: string } | { status: "done"; result: AskResult };

/**
 * "Ask your study history": a question answered only from the founder's own
 * vault, every point carrying the numbers of the sources it rests on, with
 * those sources listed underneath and one tap from where they live.
 */
export default function VaultAsk({ onOverTime }: { onOverTime: (subject: string) => void }) {
	const [question, setQuestion] = useState("");
	const [state, setState] = useState<State>({ status: "idle" });
	const [focused, setFocused] = useState<number | null>(null);
	const controller = useRef<AbortController | null>(null);

	const ask = async (text: string) => {
		const value = text.replace(/\s+/g, " ").trim();
		if (!value) return;
		controller.current?.abort();
		const abort = new AbortController();
		controller.current = abort;
		setQuestion(value);
		setFocused(null);
		setState({ status: "asking", question: value });
		try {
			// The same one-time AI sheet every SureWord AI feature asks through.
			if (!(await aiConsentGate.ensure(true, abort.signal))) {
				if (!abort.signal.aborted) setState({ status: "error", message: CONSENT_DECLINED_NOTICE });
				return;
			}
			const result = await vaultFetch<AskResult>("/api/beta/vault/ask", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: value }),
				signal: abort.signal,
			});
			if (!abort.signal.aborted) setState({ status: "done", result });
		} catch (error) {
			if (!abort.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Your question could not be answered just now." });
		}
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void ask(question);
	};
	const jump = (n: number) => {
		setFocused(n);
		document.getElementById(`vault-source-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	const busy = state.status === "asking";
	const result = state.status === "done" ? state.result : null;

	return (
		<div className="flex flex-col gap-4">
			<form onSubmit={submit} className={`${card} p-3 sm:p-4`}>
				<label htmlFor="vault-ask" className={eyebrow}>Ask your study history</label>
				<div className="mt-2 flex items-end gap-2">
					<textarea
						id="vault-ask"
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void ask(question);
							}
						}}
						rows={2}
						maxLength={400}
						placeholder="What have I studied about the Holy Spirit over the last six months?"
						className="min-h-[3.25rem] min-w-0 flex-1 resize-none rounded-xl bg-white/80 px-3 py-2.5 text-base leading-6 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-amber-700/40 dark:bg-white/[.04] dark:placeholder:text-neutral-400"
					/>
					<button
						type="submit"
						disabled={busy || !question.trim()}
						aria-label="Ask"
						className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#24281f] text-white transition-opacity disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]"
					>
						{busy ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : <ArrowUp size={20} aria-hidden />}
					</button>
				</div>
				<p className={`mt-2 text-xs leading-5 ${muted}`}>Answered only from your own notes, highlights, chats and studies, with a link to every source. Nothing you ask is saved.</p>
			</form>

			{state.status === "idle" ? (
				<div className="flex flex-wrap gap-2" aria-label="Try asking">
					{EXAMPLES.map((example) => (
						<button key={example} type="button" onClick={() => void ask(example)} className={`${tapChip} text-left leading-snug`}>
							{example}
						</button>
					))}
				</div>
			) : null}

			<div aria-live="polite">
				{busy ? (
					<div className={`${card} px-5 py-5`} aria-busy="true">
						<p className={`inline-flex items-center gap-2 text-sm font-semibold ${muted}`}>
							<LoaderCircle size={16} className="animate-spin" aria-hidden /> Reading your vault for “{state.question}”
						</p>
						<span className="mt-4 block h-4 w-full animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
						<span className="mt-2 block h-4 w-5/6 animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
						<span className="mt-2 block h-4 w-2/3 animate-pulse rounded bg-black/[.06] dark:bg-white/[.06]" />
					</div>
				) : state.status === "error" ? (
					<p role="alert" className={`${card} px-5 py-4 text-[15px]`}>{state.message}</p>
				) : result ? (
					<section aria-labelledby="vault-answer" className={`${card} px-5 py-5`}>
						<h2 id="vault-answer" className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">
							<Sparkles size={15} className="text-amber-700 dark:text-[#e5b664]" aria-hidden />
							From your vault{result.period ? `, ${result.period}` : ""}
						</h2>
						<p className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">{result.question}</p>
						{result.status === "empty" ? (
							<p className={`mt-3 text-[15px] leading-6 ${muted}`}>
								Nothing in your vault speaks to that{result.period ? ` in ${result.period}` : ""} yet. As you study it, your notes, highlights and chats about it will gather here.
							</p>
						) : (
							<ul className="mt-3 space-y-3">
								{result.points.map((point, i) => (
									<li key={i} className="text-[16px] leading-7">
										{point.text}{" "}
										{point.sources.map((n) => (
											<button
												key={n}
												type="button"
												onClick={() => jump(n)}
												aria-label={`Source ${n}: ${result.sources[n - 1]?.title ?? ""}`}
												className="relative mx-0.5 inline-flex min-h-8 min-w-8 items-center justify-center rounded-full border border-amber-700/30 px-1.5 align-baseline text-xs font-bold text-amber-900 after:absolute after:-inset-1.5 after:content-[''] hover:bg-amber-500/15 dark:border-amber-300/30 dark:text-amber-200"
											>
												{n}
											</button>
										))}
									</li>
								))}
							</ul>
						)}
						{result.status === "answered" && result.points.length === 0 ? (
							<p className={`mt-3 text-[15px] leading-6 ${muted}`}>Your vault has related study, listed below, but none of it answers that directly.</p>
						) : null}
						{result.uncovered ? <p className={`mt-4 rounded-2xl bg-black/[.035] px-4 py-3 text-[15px] leading-6 dark:bg-white/[.04] ${muted}`}>{result.uncovered}</p> : null}
					</section>
				) : null}
			</div>

			{result && result.sources.length ? (
				<section aria-labelledby="vault-sources" className="flex flex-col gap-3">
					<h2 id="vault-sources" className={eyebrow}>Sources from your vault</h2>
					<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{result.sources.map((entry, i) => (
							<VaultEntryCard key={entry.id} entry={entry} number={i + 1} highlighted={focused === i + 1} onOverTime={onOverTime} />
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
