"use client";

import { useState, type FormEvent } from "react";
import { Check, MessageCircleQuestion, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { QuestionView } from "@/lib/beta/projects/projects";
import { projectsApi } from "./api";
import { ErrorNote, card, field, ghostButton, iconButton, muted, primaryButton, secondaryButton, serifTitle } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

function QuestionRow({ question, projectId, refresh, onAsk }: { question: QuestionView; projectId: string; refresh: () => Promise<void>; onAsk: () => void }) {
	const [answering, setAnswering] = useState(false);
	const [answer, setAnswer] = useState(question.answer ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const patch = async (body: Record<string, unknown>) => {
		setBusy(true);
		setError(null);
		try {
			await projectsApi.updateItem(projectId, question.id, body);
			await refresh();
			setAnswering(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const remove = async () => {
		setError(null);
		try {
			await projectsApi.removeItem(projectId, question.id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not removed. Try again.");
		}
	};
	const save = (event: FormEvent) => {
		event.preventDefault();
		void patch({ status: "answered", answer });
	};
	const answered = question.status === "answered";
	return (
		<li className={`${card} p-4`}>
			<div className="flex items-start gap-3">
				<p className={`min-w-0 flex-1 leading-7 ${answered ? "text-neutral-600 dark:text-[#bbb3a7]" : "font-semibold"}`}>{question.text}</p>
				<button type="button" onClick={remove} aria-label="Remove this question" className={`${iconButton} -mr-2 -mt-1`}><Trash2 size={16} aria-hidden /></button>
			</div>
			{question.topics.length > 0 && <p className={`mt-0.5 text-xs font-semibold ${muted}`}>{question.topics.join(" · ")}</p>}
			{answered && question.answer && !answering && <p className="mt-2 whitespace-pre-line rounded-2xl bg-black/[.03] px-4 py-3 leading-7 dark:bg-white/[.03]">{question.answer}</p>}
			{answering ? (
				<form onSubmit={save} className="mt-3 space-y-2">
					<label className="sr-only" htmlFor={`answer-${question.id}`}>Your answer</label>
					<textarea id={`answer-${question.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} maxLength={4000} placeholder="What you found, in your own words (optional)" className={`${field} resize-y`} autoFocus />
					<div className="flex justify-end gap-2">
						<button type="button" onClick={() => setAnswering(false)} className={secondaryButton}>Cancel</button>
						<button type="submit" disabled={busy} className={primaryButton}><Check size={16} aria-hidden /> Mark answered</button>
					</div>
				</form>
			) : (
				<div className="mt-2 flex flex-wrap gap-1">
					{!answered && (
						<button type="button" onClick={onAsk} className={`${ghostButton} -ml-3`}><MessageCircleQuestion size={16} aria-hidden /> Ask the assistant</button>
					)}
					{answered ? (
						<>
							<button type="button" onClick={() => setAnswering(true)} className={`${ghostButton} -ml-3`}>Edit answer</button>
							<button type="button" disabled={busy} onClick={() => patch({ status: "open" })} className={`${ghostButton} -ml-3`}><RotateCcw size={15} aria-hidden /> Reopen</button>
						</>
					) : (
						<button type="button" onClick={() => setAnswering(true)} className={`${ghostButton} -ml-3`}><Check size={16} aria-hidden /> Mark answered</button>
					)}
				</div>
			)}
			<ErrorNote message={error} />
		</li>
	);
}

export default function QuestionsTab({ project, refresh, goTo }: TabProps) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showAnswered, setShowAnswered] = useState(false);
	const open = project.questions.filter((question) => question.status === "open");
	const answered = project.questions.filter((question) => question.status === "answered");

	const add = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await projectsApi.add(project.id, { kind: "question", text });
			setText("");
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			<section className={`${card} p-5`} aria-labelledby="add-question">
				<h2 id="add-question" className={`${serifTitle} text-[26px]`}>Your questions</h2>
				<p className={`mt-1 text-sm ${muted}`}>What are you trying to understand? Keep it here, ask the assistant, or answer it yourself as you study.</p>
				<form onSubmit={add} className="mt-3 space-y-2">
					<label className="sr-only" htmlFor="new-question">New question</label>
					<textarea id="new-question" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={1000} placeholder="Why does Paul say we glory in tribulations?" className={`${field} resize-y`} />
					<div className="flex justify-end"><button type="submit" disabled={busy || !text.trim()} className={primaryButton}><Plus size={17} aria-hidden /> Add question</button></div>
				</form>
				<ErrorNote message={error} />
			</section>

			{open.length === 0 && answered.length === 0 && <p className={`px-1 leading-7 ${muted}`}>No questions yet. The Overview suggests some when you write it.</p>}
			{open.length > 0 && (
				<ul className="space-y-3">
					{open.map((question) => <QuestionRow key={question.id} question={question} projectId={project.id} refresh={refresh} onAsk={() => goTo("ask", question.text)} />)}
				</ul>
			)}
			{answered.length > 0 && (
				<section aria-labelledby="answered-questions">
					<button type="button" id="answered-questions" onClick={() => setShowAnswered((value) => !value)} aria-expanded={showAnswered} className={`${ghostButton} -ml-3`}>
						{showAnswered ? "Hide" : "Show"} answered ({answered.length})
					</button>
					{showAnswered && (
						<ul className="mt-2 space-y-3">
							{answered.map((question) => <QuestionRow key={question.id} question={question} projectId={project.id} refresh={refresh} onAsk={() => goTo("ask", question.text)} />)}
						</ul>
					)}
				</section>
			)}
		</div>
	);
}
