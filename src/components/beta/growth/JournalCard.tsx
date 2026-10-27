"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Lock, MessageCircle } from "lucide-react";
import { REFLECTION_MAX, REFLECTION_PROMPTS, talkItOverPrompt } from "@/lib/beta/growth/growth-rules";
import type { GrowthReflection } from "./growthApi";
import { growthApi, longDay } from "./growthApi";
import { PracticeForm } from "./PracticeCard";
import { ErrorNote, card, cardTitle, eyebrow, field, goldButton, muted, quietButton, textButton } from "./ui";

const SHOWN = 5;

/**
 * The private reflection journal. Prompts are optional; an entry can name a
 * passage, turn into something to put into practice, or be talked over with
 * SureWord, which only prefills the chat: nothing is sent until the founder
 * sends it there.
 */
export default function JournalCard({
	reflections,
	prayerHabit,
	onChanged,
}: {
	reflections: GrowthReflection[];
	/** The prayer habit's name, when they keep one: a reflection keeps it for the day. */
	prayerHabit: string | null;
	onChanged: () => Promise<void>;
}) {
	const [showAll, setShowAll] = useState(false);
	const shown = showAll ? reflections : reflections.slice(0, SHOWN);
	return (
		<section aria-labelledby="growth-journal-title" className={`${card} px-4 py-5 sm:px-5`}>
			<h2 id="growth-journal-title" className={cardTitle}>Reflection journal</h2>
			<p className={`mt-1 flex items-start gap-1.5 text-sm ${muted}`}>
				<Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
				<span>Private to you. Never sent to AI unless you choose Talk it over and send it yourself.</span>
			</p>
			<Composer prayerHabit={prayerHabit} onChanged={onChanged} />

			{reflections.length > 0 && (
				<div className="mt-5 border-t border-black/[.06] pt-4 dark:border-white/[.06]">
					<h3 className={eyebrow}>Your reflections</h3>
					<ul className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.06]">
						{shown.map((entry) => (
							<Entry key={`${entry.id}:${entry.updatedAt}`} entry={entry} onChanged={onChanged} />
						))}
					</ul>
					{reflections.length > SHOWN && (
						<button type="button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll} className={textButton}>
							{showAll ? "Show fewer" : `Show all ${reflections.length}`}
						</button>
					)}
				</div>
			)}
		</section>
	);
}

function Composer({ prayerHabit, onChanged }: { prayerHabit: string | null; onChanged: () => Promise<void> }) {
	const [prompt, setPrompt] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [passage, setPassage] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!text.trim()) return;
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			await growthApi.addReflection({ text, prompt, passage: passage.trim() || null });
			setText("");
			setPassage("");
			setPrompt(null);
			setSaved(true);
			await onChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<form onSubmit={submit} className="mt-4 space-y-3">
			<div>
				<p className={`text-sm ${muted}`}>A prompt, if it helps:</p>
				<div className="-mx-1 mt-1.5 flex gap-2 overflow-x-auto px-1 pb-1">
					{REFLECTION_PROMPTS.map((entry) => (
						<button
							key={entry}
							type="button"
							onClick={() => setPrompt(prompt === entry ? null : entry)}
							aria-pressed={prompt === entry}
							className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm ${
								prompt === entry
									? "border-amber-700/50 bg-amber-500/15 font-bold text-amber-950 dark:border-[#e5b664]/60 dark:text-amber-100"
									: "border-black/10 text-neutral-700 hover:bg-black/[.04] dark:border-white/15 dark:text-neutral-200 dark:hover:bg-white/[.05]"
							}`}
						>
							{entry}
						</button>
					))}
				</div>
			</div>
			<label className="block">
				<span className={prompt ? "mb-1.5 block font-[family-name:var(--font-cormorant)] text-[21px] font-semibold leading-snug" : "sr-only"}>
					{prompt ?? "Your reflection"}
				</span>
				<textarea
					value={text}
					onChange={(event) => {
						setText(event.target.value);
						setSaved(false);
					}}
					maxLength={REFLECTION_MAX}
					rows={4}
					placeholder="Write a private reflection…"
					className={`${field} resize-y leading-7`}
				/>
			</label>
			<label className="block">
				<span className="sr-only">Passage (optional)</span>
				<input value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="Passage (optional), e.g. Psalm 23" className={field} />
			</label>
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap items-center gap-3">
				<button type="submit" disabled={saving || !text.trim()} className={goldButton}>
					{saving ? "Saving…" : "Save reflection"}
				</button>
				{saved && (
					<p role="status" className={`text-sm ${muted}`}>
						{prayerHabit ? `Saved. It also keeps ${prayerHabit.toLowerCase()} for today.` : "Saved."}
					</p>
				)}
			</div>
		</form>
	);
}

function Entry({ entry, onChanged }: { entry: GrowthReflection; onChanged: () => Promise<void> }) {
	const [mode, setMode] = useState<"read" | "edit" | "practice" | "confirm">("read");
	const [text, setText] = useState(entry.text);
	const [passage, setPassage] = useState(entry.passage ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = async (work: () => Promise<unknown>) => {
		setSaving(true);
		setError(null);
		try {
			await work();
			await onChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
			setSaving(false);
		}
	};
	return (
		<li className="py-3.5">
			<p className={eyebrow}>{longDay(entry.day)}{entry.passage ? ` · ${entry.passage}` : ""}</p>
			{entry.prompt && <p className="mt-1 font-[family-name:var(--font-cormorant)] text-[19px] font-semibold leading-snug">{entry.prompt}</p>}
			{mode === "edit" ? (
				<div className="mt-2 space-y-2.5">
					<textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={REFLECTION_MAX} rows={4} className={`${field} resize-y leading-7`} aria-label="Edit reflection" />
					<input value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="Passage (optional)" className={field} aria-label="Passage (optional)" />
					{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							disabled={saving || !text.trim()}
							onClick={() => run(() => growthApi.updateReflection(entry.id, { text, passage: passage.trim() || null }))}
							className={goldButton}
						>
							Save
						</button>
						<button type="button" onClick={() => { setMode("read"); setText(entry.text); setPassage(entry.passage ?? ""); }} className={textButton}>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<p className="mt-1.5 whitespace-pre-line leading-7">{entry.text}</p>
			)}

			{mode === "practice" && (
				<div className="mt-3 rounded-2xl border border-black/[.08] p-3 dark:border-white/[.08]">
					<p className={`mb-2 text-sm ${muted}`}>What from this do you want to put into practice?</p>
					<PracticeForm reflectionId={entry.id} onSaved={onChanged} onCancel={() => setMode("read")} />
				</div>
			)}

			{mode === "confirm" && (
				<div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
					<span>Delete this reflection for good?</span>
					<button type="button" disabled={saving} onClick={() => run(() => growthApi.removeReflection(entry.id))} className={quietButton}>
						Delete
					</button>
					<button type="button" onClick={() => setMode("read")} className={textButton}>
						Keep it
					</button>
				</div>
			)}
			{error && mode !== "edit" && (
				<div className="mt-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			{mode === "read" && (
				<div className="mt-1 flex flex-wrap items-center gap-x-1">
					<button type="button" onClick={() => setMode("practice")} className={textButton}>
						Put into practice
					</button>
					<Link prefetch={false} href={`/?prompt=${encodeURIComponent(talkItOverPrompt("reflection", entry.text, entry.passage))}`} className={textButton}>
						<MessageCircle size={15} aria-hidden /> Talk it over
					</Link>
					<button type="button" onClick={() => setMode("edit")} className={`${textButton} text-neutral-700 dark:text-neutral-300`}>
						Edit
					</button>
					<button type="button" onClick={() => setMode("confirm")} className={`${textButton} text-neutral-600 dark:text-neutral-400`}>
						Delete
					</button>
				</div>
			)}
		</li>
	);
}
