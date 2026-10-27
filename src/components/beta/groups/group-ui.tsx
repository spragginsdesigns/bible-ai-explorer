"use client";

import { useState } from "react";
import { Headphones, Loader2, Pause, Trash2 } from "lucide-react";
import type { PassageAudio } from "@/components/beta/kids/usePassageAudio";
import { quietButton } from "@/components/beta/rooms/room-ui";
import { QUESTION_TYPE_LABEL, type GroupPersonView, type GroupRole, type QuestionType, type VerseView } from "@/lib/beta/groups/groups-rules";

const TYPE_TONE: Record<QuestionType, string> = {
	observe: "border-sky-700/20 bg-sky-500/[.08] text-sky-900 dark:border-sky-200/20 dark:text-sky-200",
	interpret: "border-violet-700/20 bg-violet-500/[.08] text-violet-900 dark:border-violet-200/20 dark:text-violet-200",
	apply: "border-emerald-700/20 bg-emerald-500/[.08] text-emerald-900 dark:border-emerald-200/20 dark:text-emerald-200",
};

/** Observe, Interpretation or Apply: an interpretation question is labelled as one. */
export function TypeChip({ type }: { type: QuestionType }) {
	return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${TYPE_TONE[type]}`}>{QUESTION_TYPE_LABEL[type]}</span>;
}

export function RoleBadge({ role }: { role: GroupRole }) {
	if (role === "member") return null;
	return <span className="shrink-0 rounded-full border border-black/10 px-2 text-xs font-bold text-neutral-600 dark:border-white/10 dark:text-[#b3ad9e]">{role === "owner" ? "Owner" : "Leader"}</span>;
}

/** "You", or the name they go by in the group, with their role when they lead it. */
export function PersonName({ person }: { person: GroupPersonView }) {
	return (
		<>
			<span className="truncate font-bold text-neutral-800 dark:text-[#e9dfcb]">{person.isYou ? "You" : person.displayName}</span>
			{!person.isYou && <RoleBadge role={person.role} />}
		</>
	);
}

/** A trash button that asks once before it removes. */
export function RemoveButton({ label, busy, onRemove, confirm = "Remove" }: { label: string; busy: boolean; onRemove: () => void; confirm?: string }) {
	const [confirming, setConfirming] = useState(false);
	if (!confirming) {
		return (
			<button type="button" onClick={() => setConfirming(true)} aria-label={label} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100">
				<Trash2 size={17} aria-hidden />
			</button>
		);
	}
	return (
		<span className="flex shrink-0 items-center gap-1 text-sm">
			<button type="button" onClick={onRemove} disabled={busy} className="min-h-11 rounded-full px-3 font-bold text-red-800 hover:bg-red-500/10 dark:text-red-300">
				{busy ? "Removing…" : confirm}
			</button>
			<button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-3 font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				Keep
			</button>
		</span>
	);
}

/** Verses from the bundled KJV, numbered; the one being read aloud is marked. */
export function VerseLines({ verses, current, size = "lg" }: { verses: readonly VerseView[]; current?: number | null; size?: "lg" | "sm" }) {
	return (
		<p className={size === "lg" ? "font-[family-name:var(--font-cormorant)] text-[20px] leading-[1.55]" : "font-[family-name:var(--font-cormorant)] text-[17px] leading-[1.5] text-neutral-800 dark:text-[#e9dfcb]"}>
			{verses.map(({ verse, text }) => (
				<span key={verse} className={current === verse ? "rounded bg-amber-400/25 dark:bg-amber-300/20" : undefined}>
					<sup className="relative -top-[0.5em] mr-0.5 align-baseline font-sans text-xs font-bold text-amber-800/80 dark:text-[#e5b664]/80">{verse}</sup>
					{text}{" "}
				</span>
			))}
		</p>
	);
}

/** "19, 21-23" -> [19, 21, 22, 23]; null when it is not a list of verse numbers. */
export function parseVerseList(text: string): number[] | null {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const out = new Set<number>();
	for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
		const range = /^(\d{1,3})(?:[-–](\d{1,3}))?$/.exec(part);
		if (!range) return null;
		const start = Number(range[1]);
		const end = range[2] ? Number(range[2]) : start;
		if (start < 1 || end < start || end - start > 40) return null;
		for (let verse = start; verse <= end; verse++) out.add(verse);
	}
	return [...out].sort((a, b) => a - b);
}

/** Play or pause the audio Bible's recording of a passage; hidden when it has none. */
export function ListenControl({ reference, audio }: { reference: string; audio: PassageAudio }) {
	if (audio.status === "unavailable") return null;
	return (
		<button
			type="button"
			onClick={audio.toggle}
			disabled={audio.status !== "ready"}
			aria-label={audio.playing ? `Pause ${reference}` : `Listen to ${reference}`}
			className={`${quietButton} border border-black/10 dark:border-white/10`}
		>
			{audio.status === "loading" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : audio.playing ? <Pause size={16} aria-hidden /> : <Headphones size={16} aria-hidden />}
			{audio.playing ? "Pause" : "Listen"}
		</button>
	);
}
