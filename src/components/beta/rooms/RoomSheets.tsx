"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Loader2, NotebookPen, Search, Share2 } from "lucide-react";
import type { RoomView } from "@/lib/beta/rooms/rooms";
import { roomInvitePath } from "@/lib/beta/rooms/rooms-rules";
import type { RoomAct } from "./RoomScreen";
import { ErrorNote, Sheet, field, primaryButton, quietButton, secondaryButton, timeAgo } from "./room-ui";

export function InviteSheet({ room, act, busy, onClose }: { room: RoomView; act: RoomAct; busy: string | null; onClose: () => void }) {
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [canShare, setCanShare] = useState(false);
	useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
	const token = room.inviteToken ?? null;
	const link = token ? `${window.location.origin}${roomInvitePath(token)}` : null;

	const change = async (on: boolean) => {
		setError(null);
		setCopied(false);
		const result = await act(on ? "invite-on" : "invite-off", `/api/beta/rooms/${room.id}/invite`, { method: on ? "POST" : "DELETE" });
		if (!result.ok) setError(result.error);
	};
	const copy = async () => {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
		} catch {
			setError("Could not copy. Press and hold the link to copy it.");
		}
	};

	return (
		<Sheet title="Invite to the room" onClose={onClose}>
			<p className="leading-7 text-neutral-700 dark:text-[#d9d1c3]">
				Anyone on the SureWord Beta list who opens this link can join {room.name}. Making a new link or turning it off stops the old one from working; people already in the room stay in.
			</p>
			{link ? (
				<>
					<label className="mt-4 block">
						<span className="mb-1.5 block text-sm font-bold">Invite link</span>
						<input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className={`${field} font-mono text-sm`} />
					</label>
					<div className="mt-3 flex flex-wrap gap-2">
						<button type="button" onClick={() => void copy()} className={primaryButton}>
							{copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />} {copied ? "Copied" : "Copy link"}
						</button>
						{canShare && (
							<button type="button" onClick={() => void navigator.share({ title: room.name, text: `Join "${room.name}" on SureWord`, url: link }).catch(() => {})} className={secondaryButton}>
								<Share2 size={17} aria-hidden /> Share
							</button>
						)}
					</div>
					<div className="mt-4 flex flex-wrap gap-1 border-t border-black/[.08] pt-3 dark:border-white/[.08]">
						<button type="button" onClick={() => void change(true)} disabled={busy !== null} className={`${quietButton} -ml-3`}>
							{busy === "invite-on" ? "Making a new link…" : "Make a new link"}
						</button>
						<button type="button" onClick={() => void change(false)} disabled={busy !== null} className={quietButton}>
							{busy === "invite-off" ? "Turning off…" : "Turn the link off"}
						</button>
					</div>
				</>
			) : (
				<div className="mt-4">
					<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">The invite link is off.</p>
					<button type="button" onClick={() => void change(true)} disabled={busy !== null} className={`${primaryButton} mt-3`}>
						<Link2 size={17} aria-hidden /> {busy === "invite-on" ? "Creating…" : "Create an invite link"}
					</button>
				</div>
			)}
			{error && (
				<div className="mt-3">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
		</Sheet>
	);
}

interface NoteSummary {
	id: string;
	title: string;
	preview: string;
	/** The preview stops short of the note's text. */
	clipped: boolean;
	updatedAt: string;
}

const PREVIEW_LENGTH = 140;

/**
 * Pick one of your own notes to share. The list comes from the ordinary notes
 * API, which only ever returns the caller's notes; nothing is shared until the
 * person confirms, and then only a copy of that one note.
 */
export function ShareNoteSheet({ room, act, onClose, onShared }: { room: RoomView; act: RoomAct; onClose: () => void; onShared: () => void }) {
	const [notes, setNotes] = useState<NoteSummary[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<NoteSummary | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/notes?summary=1", { cache: "no-store" })
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error("notes"))))
			.then((data: { id: string; title: string; plainText?: string | null; updatedAt: string }[]) => {
				if (cancelled || !Array.isArray(data)) return;
				setNotes(
					data.map((note) => {
						const text = (note.plainText ?? "").trim();
						return { id: note.id, title: note.title || "Untitled note", preview: text.slice(0, PREVIEW_LENGTH), clipped: text.length > PREVIEW_LENGTH, updatedAt: note.updatedAt };
					}),
				);
			})
			.catch(() => !cancelled && setLoadError(true));
		return () => {
			cancelled = true;
		};
	}, []);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (notes ?? []).filter((note) => !q || note.title.toLowerCase().includes(q) || note.preview.toLowerCase().includes(q));
	}, [notes, query]);

	const share = async () => {
		if (!picked) return;
		setSending(true);
		setError(null);
		const result = await act("share-note", `/api/beta/rooms/${room.id}/posts`, { method: "POST", body: { kind: "note", noteId: picked.id } });
		setSending(false);
		if (result.ok) onShared();
		else setError(result.error);
	};

	return (
		<Sheet title={picked ? "Share this note?" : "Share one of your notes"} onClose={onClose}>
			{picked ? (
				<>
					<div className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
						<p className="font-bold">{picked.title}</p>
						{picked.preview && (
							<p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
								{picked.preview}
								{picked.clipped && "…"}
							</p>
						)}
					</div>
					<p className="mt-3 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						Everyone in {room.name} will see a copy of this note. Your note stays in your notes and stays private: later changes to it are not shared, and you can remove the copy from the room at any time.
					</p>
					{error && (
						<div className="mt-3">
							<ErrorNote message={error} onDismiss={() => setError(null)} />
						</div>
					)}
					<div className="mt-4 flex flex-wrap gap-2">
						<button type="button" onClick={() => void share()} disabled={sending} className={primaryButton}>
							{sending ? "Sharing…" : "Share a copy"}
						</button>
						<button type="button" onClick={() => setPicked(null)} className={secondaryButton}>
							Pick another
						</button>
					</div>
				</>
			) : (
				<>
					<p className="text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">Only you see this list. Nothing is shared until you choose a note and confirm.</p>
					<div className="relative mt-3">
						<Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden />
						<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes" aria-label="Search your notes" className={`${field} pl-10`} />
					</div>
					<div className="mt-3 min-h-24">
						{notes === null && !loadError && (
							<p className="flex items-center gap-2 py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">
								<Loader2 size={16} className="animate-spin" aria-hidden /> Loading your notes…
							</p>
						)}
						{loadError && <ErrorNote message="Could not load your notes. Close this and try again." />}
						{notes !== null && shown.length === 0 && (
							<p className="py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">{notes.length === 0 ? "You have no notes yet. Write one in Notes, or add a note to the room directly." : "No notes match that search."}</p>
						)}
						<ul className="space-y-1">
							{shown.map((note) => (
								<li key={note.id}>
									<button type="button" onClick={() => setPicked(note)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.04]">
										<NotebookPen size={17} className="shrink-0 text-neutral-500" aria-hidden />
										<span className="min-w-0 flex-1">
											<span className="block truncate font-bold">{note.title}</span>
											{note.preview && <span className="block truncate text-sm text-neutral-600 dark:text-[#bbb3a7]">{note.preview}</span>}
										</span>
										<span className="shrink-0 text-xs text-neutral-500">{timeAgo(note.updatedAt)}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				</>
			)}
		</Sheet>
	);
}

export function ReplacePlanSheet({ current, planTitle, busy, onConfirm, onClose }: { current: { id: string; title: string }; planTitle: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
	return (
		<Sheet title="Replace your reading plan?" onClose={onClose}>
			<p className="leading-7 text-neutral-700 dark:text-[#d9d1c3]">
				You are reading &ldquo;{current.title}&rdquo;. SureWord keeps one reading plan at a time, so following {planTitle} puts that one away. Your progress on it is kept in your history.
			</p>
			<div className="mt-4 flex flex-wrap gap-2">
				<button type="button" onClick={onConfirm} disabled={busy} className={primaryButton}>
					{busy ? "Starting…" : `Follow ${planTitle}`}
				</button>
				<button type="button" onClick={onClose} className={secondaryButton}>
					Keep my plan
				</button>
			</div>
		</Sheet>
	);
}
