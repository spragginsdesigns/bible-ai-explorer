"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { FOLLOW_UP_LABELS, PRACTICE_MAX, talkItOverPrompt, type FollowUpChoice } from "@/lib/beta/growth/growth-rules";
import type { GrowthPractice } from "./growthApi";
import { growthApi, shortDay } from "./growthApi";
import { ErrorNote, card, cardTitle, eyebrow, field, goldButton, muted, quietButton, textButton } from "./ui";

const FOLLOW_UP_CHOICES: FollowUpChoice[] = ["3d", "1w", "2w", "1m", "none"];

/** "We'll ask how it's going on Nov 2", or nothing when they asked for no follow-up. */
function followUpLine(practice: GrowthPractice): string | null {
	if (practice.status === "lived") return null;
	if (practice.due) return "Its follow-up is waiting in Today.";
	return practice.followUpOn ? `We'll ask how it's going on ${shortDay(practice.followUpOn)}.` : "No follow-up. It stays here until you change it.";
}

/** The form for something to put into practice, on its own or from a reflection. */
export function PracticeForm({
	reflectionId,
	onSaved,
	onCancel,
}: {
	reflectionId: string | null;
	onSaved: () => Promise<void>;
	onCancel?: () => void;
}) {
	const [text, setText] = useState("");
	const [passage, setPassage] = useState("");
	const [followUp, setFollowUp] = useState<FollowUpChoice>("1w");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!text.trim()) return;
		setSaving(true);
		setError(null);
		try {
			await growthApi.addPractice({ text, passage: passage.trim() || null, followUp, reflectionId });
			setText("");
			setPassage("");
			await onSaved();
			onCancel?.();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
		} finally {
			setSaving(false);
		}
	};
	const id = reflectionId ? `practice-${reflectionId}` : "practice-new";
	return (
		<form onSubmit={submit} className="space-y-2.5">
			<label htmlFor={`${id}-text`} className="sr-only">
				What you want to put into practice
			</label>
			<textarea
				id={`${id}-text`}
				value={text}
				onChange={(event) => setText(event.target.value)}
				maxLength={PRACTICE_MAX}
				rows={2}
				placeholder="Something you want to live out, like being swift to hear"
				className={`${field} resize-y`}
			/>
			<div className="flex flex-wrap gap-2">
				<label className="min-w-0 flex-1 basis-40">
					<span className="sr-only">Passage (optional)</span>
					<input value={passage} onChange={(event) => setPassage(event.target.value)} placeholder="Passage (optional)" className={field} />
				</label>
				<label className="flex items-center gap-2 text-sm">
					<span className={muted}>Follow up</span>
					<select value={followUp} onChange={(event) => setFollowUp(event.target.value as FollowUpChoice)} className={`${field} min-h-11 w-auto py-1.5`}>
						{FOLLOW_UP_CHOICES.map((choice) => (
							<option key={choice} value={choice}>
								{FOLLOW_UP_LABELS[choice]}
							</option>
						))}
					</select>
				</label>
			</div>
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap gap-2">
				<button type="submit" disabled={saving || !text.trim()} className={goldButton}>
					{saving ? "Saving…" : "Put into practice"}
				</button>
				{onCancel && (
					<button type="button" onClick={onCancel} className={textButton}>
						Cancel
					</button>
				)}
			</div>
		</form>
	);
}

/** What the founder chose to put into practice, and what has become part of them. */
export default function PracticeCard({
	practices,
	onChanged,
	onPractice,
}: {
	practices: GrowthPractice[];
	onChanged: () => Promise<void>;
	onPractice: (id: string, action: Record<string, unknown>) => Promise<string | null>;
}) {
	const [adding, setAdding] = useState(false);
	const [showLived, setShowLived] = useState(false);
	const active = practices.filter((practice) => practice.status === "active");
	const lived = practices.filter((practice) => practice.status === "lived");

	return (
		<section aria-labelledby="growth-practice-title" className={`${card} px-4 py-5 sm:px-5`}>
			<h2 id="growth-practice-title" className={cardTitle}>Putting into practice</h2>
			<p className={`mt-1 text-sm ${muted}`}>Insights you chose to live out. SureWord follows up only when you ask it to.</p>

			{active.length > 0 && (
				<ul className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.06]">
					{active.map((practice) => (
						<PracticeRow key={practice.id} practice={practice} onPractice={onPractice} onChanged={onChanged} />
					))}
				</ul>
			)}
			{!active.length && !adding && <p className="mt-3 leading-6">Nothing yet. When a passage or a reflection asks something of you, put it here.</p>}

			<div className="mt-3">
				{adding ? (
					<PracticeForm reflectionId={null} onSaved={onChanged} onCancel={() => setAdding(false)} />
				) : (
					<button type="button" onClick={() => setAdding(true)} className={textButton}>
						Add something to put into practice
					</button>
				)}
			</div>

			{lived.length > 0 && (
				<div className="mt-3 border-t border-black/[.06] pt-2 dark:border-white/[.06]">
					<button type="button" onClick={() => setShowLived((value) => !value)} aria-expanded={showLived} className={textButton}>
						{showLived ? "Hide" : "Show"} what has become part of you ({lived.length})
					</button>
					{showLived && (
						<ul className="mt-1 divide-y divide-black/[.06] dark:divide-white/[.06]">
							{lived.map((practice) => (
								<PracticeRow key={practice.id} practice={practice} onPractice={onPractice} onChanged={onChanged} />
							))}
						</ul>
					)}
				</div>
			)}
		</section>
	);
}

function PracticeRow({
	practice,
	onPractice,
	onChanged,
}: {
	practice: GrowthPractice;
	onPractice: (id: string, action: Record<string, unknown>) => Promise<string | null>;
	onChanged: () => Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const line = followUpLine(practice);
	const act = async (action: Record<string, unknown>) => {
		setSaving(true);
		setError(null);
		setError(await onPractice(practice.id, action));
		setSaving(false);
	};
	const remove = async () => {
		setSaving(true);
		setError(null);
		try {
			await growthApi.removePractice(practice.id);
			await onChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
			setSaving(false);
		}
	};
	return (
		<li className="py-3">
			<p className="font-bold leading-6">{practice.text}</p>
			<p className={`text-sm ${muted}`}>
				{practice.passage ? `${practice.passage} · ` : ""}Chosen {shortDay(practice.day)}
				{practice.status === "lived" ? " · Part of you now" : ""}
			</p>
			{line && <p className={`mt-1 text-sm ${muted}`}>{line}</p>}
			{practice.notes.length > 0 && (
				<ul className="mt-2 space-y-1.5 border-l-2 border-[#e5b664]/60 pl-3">
					{practice.notes.map((entry, index) => (
						<li key={`${entry.day}-${index}`} className="text-sm leading-6">
							<span className={`${eyebrow} mr-1.5 tracking-[.12em]`}>{shortDay(entry.day)}</span>
							{entry.note}
						</li>
					))}
				</ul>
			)}
			{error && (
				<div className="mt-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
			<div className="mt-1.5 flex flex-wrap items-center gap-x-1">
				{practice.status === "active" ? (
					<button type="button" disabled={saving} onClick={() => act({ action: "lived", note: null })} className={textButton}>
						It&rsquo;s part of me now
					</button>
				) : (
					<button type="button" disabled={saving} onClick={() => act({ action: "reopen", next: "1w" })} className={textButton}>
						Practise it again
					</button>
				)}
				<Link prefetch={false} href={`/?prompt=${encodeURIComponent(talkItOverPrompt("practice", practice.text, practice.passage))}`} className={textButton}>
					<MessageCircle size={15} aria-hidden /> Talk it over
				</Link>
				{confirming ? (
					<span className="flex items-center gap-1 text-sm">
						<span>Remove it?</span>
						<button type="button" disabled={saving} onClick={remove} className={quietButton}>
							Remove
						</button>
						<button type="button" onClick={() => setConfirming(false)} className={textButton}>
							Keep
						</button>
					</span>
				) : (
					<button type="button" onClick={() => setConfirming(true)} className={`${textButton} text-neutral-600 dark:text-neutral-400`}>
						Remove
					</button>
				)}
			</div>
		</li>
	);
}
