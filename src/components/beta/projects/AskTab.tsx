"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, CircleAlert, Plus } from "lucide-react";
import type { AnswerView } from "@/lib/beta/projects/projects";
import Citations from "./Citations";
import { projectsApi } from "./api";
import { ErrorNote, SkeletonLine, card, chip, ghostButton, muted, plural } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

const BASIS_LABEL = { interpretation: "Interpretation", source: "From a source", gap: "Not in your materials", scripture: null } as const;

function Answer({ answer, onAddQuestion }: { answer: AnswerView; onAddQuestion: () => void }) {
	return (
		<article className={`${card} p-5`} aria-label={`Answer to: ${answer.question}`}>
			<div className="space-y-4">
				{answer.segments.map((segment, index) => {
					const label = BASIS_LABEL[segment.basis];
					return (
						<div key={index} className={segment.unsupported ? "opacity-70" : undefined}>
							{label && <p className="mb-0.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-500 dark:text-[#a59f92]">{label}</p>}
							<p className="text-[16px] leading-7">{segment.text}</p>
							{segment.unsupported && (
								<p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200"><CircleAlert size={14} aria-hidden /> No citation in this project backs this sentence.</p>
							)}
							{segment.unverifiedQuote && (
								<p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200"><CircleAlert size={14} aria-hidden /> Its quotation is from elsewhere in your project, not from what it cites.</p>
							)}
							<Citations citations={segment.citations} />
						</div>
					);
				})}
			</div>
			{answer.missing && (
				<div className="mt-4 rounded-2xl border border-amber-700/25 bg-amber-500/[.07] px-4 py-3 dark:border-amber-300/25">
					<p className="text-sm font-bold">To answer this from your project:</p>
					<p className="mt-0.5 text-sm leading-6">{answer.missing}</p>
				</div>
			)}
			{!answer.answerable && (
				<button type="button" onClick={onAddQuestion} className={`${ghostButton} -ml-3 mt-2`}><Plus size={16} aria-hidden /> Keep this as an open question</button>
			)}
		</article>
	);
}

export default function AskTab({ project, refresh, prefill }: TabProps & { prefill: { text: string; key: number } | null }) {
	const [question, setQuestion] = useState(prefill?.text ?? "");
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	const end = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (prefill) {
			setQuestion(prefill.text);
			input.current?.focus();
		}
	}, [prefill]);

	const ask = async (event?: FormEvent) => {
		event?.preventDefault();
		const text = question.trim();
		if (!text || pending) return;
		setPending(text);
		setError(null);
		try {
			await projectsApi.ask(project.id, text);
			setQuestion("");
			await refresh();
			setTimeout(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 50);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The assistant could not answer. Try again.");
		} finally {
			setPending(null);
		}
	};
	const keep = async (text: string) => {
		try {
			await projectsApi.add(project.id, { kind: "question", text, origin: "answer" });
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		}
	};

	const material = project.passages.length + project.sources.length;
	const suggestions = project.questions.filter((q) => q.status === "open").slice(0, 3).map((q) => q.text);
	return (
		<div className="space-y-4">
			<p className={`px-1 text-sm leading-6 ${muted}`}>
				Answers come only from this project: {plural(project.passages.length, "passage")}, {plural(project.sources.length, "source")}
				{project.scope.type === "book" ? `, and the chapters of ${project.scope.bookName}` : ""}. Every claim shows the verse or source behind it, and Scripture is shown in the King James text. The last 60 answers are kept.
			</p>
			{material === 0 && project.scope.type !== "book" && !project.sections.some((s) => s.ref) && (
				<p className="rounded-2xl border border-black/10 px-4 py-3 text-sm dark:border-white/10">Add a passage or a source first, so the assistant has something to read.</p>
			)}

			{project.answers.map((answer) => (
				<div key={answer.id} className="space-y-2">
					<p className="ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-[#24281f] px-4 py-2.5 text-[15px] leading-6 text-white dark:bg-[#2b3126]">{answer.question}</p>
					<Answer answer={answer} onAddQuestion={() => keep(answer.question)} />
				</div>
			))}

			{pending && (
				<div className="space-y-2" aria-live="polite" aria-busy="true">
					<p className="ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-[#24281f] px-4 py-2.5 text-[15px] leading-6 text-white dark:bg-[#2b3126]">{pending}</p>
					<div className={`${card} space-y-2.5 p-5`}>
						<p className="text-sm font-bold">Searching your passages and sources…</p>
						<SkeletonLine width="w-5/6" />
						<SkeletonLine />
						<SkeletonLine width="w-2/3" />
					</div>
				</div>
			)}
			<div ref={end} />

			{project.answers.length === 0 && !pending && suggestions.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{suggestions.map((text) => (
						<button key={text} type="button" onClick={() => setQuestion(text)} className={`${chip} h-auto py-1.5 text-left`}>{text}</button>
					))}
				</div>
			)}

			<form onSubmit={ask} className="rounded-[22px] border border-black/10 bg-white/80 p-1.5 focus-within:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus-within:border-amber-300/40">
				<label htmlFor="project-ask" className="sr-only">Ask about this project</label>
				<div className="flex items-end gap-2">
					<textarea
						id="project-ask"
						ref={input}
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void ask();
							}
						}}
						rows={2}
						maxLength={1000}
						placeholder={`Ask about ${project.title}…`}
						className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
					/>
					<button type="submit" disabled={!question.trim() || Boolean(pending)} aria-label="Ask" className="mb-0.5 mr-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#24281f] text-white transition-opacity disabled:opacity-35 dark:bg-[#e5b664] dark:text-[#1c2118]">
						<ArrowUp size={20} aria-hidden />
					</button>
				</div>
			</form>
			<ErrorNote message={error} />
		</div>
	);
}
