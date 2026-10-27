"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, NotebookPen, Trash2 } from "lucide-react";
import type { VoiceSessionSummary } from "@/lib/beta/voice/sessions";

function when(iso: string, seconds: number): string {
	const date = new Date(iso);
	const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	const minutes = Math.max(1, Math.round(seconds / 60));
	return `${day}, ${time} · ${minutes} min`;
}

/**
 * Earlier conversations, newest first. Each is kept in the study store; a Note
 * can be saved from any of them, and forgetting one leaves its Note alone.
 */
export default function VoiceSessions({ sessions, onChange }: { sessions: readonly VoiceSessionSummary[]; onChange: (next: VoiceSessionSummary[]) => void }) {
	const [busy, setBusy] = useState<string | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	if (sessions.length === 0) return null;

	async function saveNote(id: string) {
		setBusy(id);
		setFailed(null);
		try {
			const response = await fetch(`/api/beta/voice/sessions/${encodeURIComponent(id)}/note`, { method: "POST" });
			if (!response.ok) throw new Error();
			const body = (await response.json()) as { note: { noteId: string } };
			onChange(sessions.map((session) => (session.id === id ? { ...session, noteId: body.note.noteId } : session)));
		} catch {
			setFailed(id);
		} finally {
			setBusy(null);
		}
	}

	async function forget(id: string) {
		if (!window.confirm("Forget this conversation? A note saved from it stays in Notes.")) return;
		setBusy(id);
		const response = await fetch(`/api/beta/voice/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
		setBusy(null);
		if (response?.ok) onChange(sessions.filter((session) => session.id !== id));
		else setFailed(id);
	}

	return (
		<section aria-labelledby="voice-sessions" className="mt-10">
			<h2 id="voice-sessions" className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-none">
				Recent conversations
			</h2>
			<ul className="mt-4 divide-y divide-black/[.07] overflow-hidden rounded-[22px] border border-black/[.09] bg-white/35 dark:divide-white/[.07] dark:border-white/[.09] dark:bg-white/[.025]">
				{sessions.map((session) => (
					<li key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<p className="font-[family-name:var(--font-cormorant)] text-[20px] font-semibold leading-6">{session.title}</p>
							<p className="mt-0.5 text-sm text-neutral-600 dark:text-[#bbb3a7]">
								{when(session.startedAt, session.durationSeconds)}
								{session.references.length > 0 && ` · ${session.references.slice(0, 3).join(", ")}${session.references.length > 3 ? ` +${session.references.length - 3}` : ""}`}
							</p>
							{failed === session.id && <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-300">That did not go through. Try again.</p>}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							{session.noteId ? (
								<Link href={`/notes?note=${encodeURIComponent(session.noteId)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-black/10 px-4 text-sm font-bold dark:border-white/15">
									<CheckCircle2 size={16} className="text-amber-700 dark:text-[#e5b664]" aria-hidden /> Open note
								</Link>
							) : (
								<button
									type="button"
									disabled={busy === session.id}
									onClick={() => void saveNote(session.id)}
									className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-black/10 px-4 text-sm font-bold disabled:opacity-50 dark:border-white/15"
								>
									<NotebookPen size={16} aria-hidden /> {busy === session.id ? "Saving..." : "Save as note"}
								</button>
							)}
							<button
								type="button"
								aria-label={`Forget "${session.title}"`}
								disabled={busy === session.id}
								onClick={() => void forget(session.id)}
								className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 disabled:opacity-50 dark:text-[#b3ad9e] dark:hover:bg-white/5"
							>
								<Trash2 size={17} aria-hidden />
							</button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
