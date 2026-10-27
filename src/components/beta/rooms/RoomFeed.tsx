"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, MessageCircleQuestion, NotebookPen, UserPlus } from "lucide-react";
import type { RoomView } from "@/lib/beta/rooms/rooms";
import { NOTE_MAX, NOTE_TITLE_MAX, PASSAGE_COMMENT_MAX, QUESTION_MAX, type RoomPostKind } from "@/lib/beta/rooms/rooms-rules";
import type { RoomAct } from "./RoomScreen";
import RoomPostCard from "./RoomPostCard";
import { ErrorNote, card, field, primaryButton, quietButton, secondaryButton } from "./room-ui";

type FeedKind = Exclude<RoomPostKind, "reply">;

const EMPTY: Record<FeedKind, { Icon: typeof BookOpen; title: string; text: string }> = {
	passage: {
		Icon: BookOpen,
		title: "No passages yet",
		text: "Share the chapter or verses you are reading together. Everyone sees them in the King James text, with a way into the Bible.",
	},
	question: {
		Icon: MessageCircleQuestion,
		title: "No questions yet",
		text: "Ask the group something to talk through, about this week's reading or anything you are studying together.",
	},
	note: {
		Icon: NotebookPen,
		title: "No shared notes yet",
		text: "Write a note for the group here, or share one of your own notes. Only the copy you share is seen; the note stays yours.",
	},
};

export default function RoomFeed({
	room,
	kind,
	act,
	busy,
	onShareNote,
	onGoToGroup,
	onInvite,
}: {
	room: RoomView;
	kind: FeedKind;
	act: RoomAct;
	busy: string | null;
	onShareNote: () => void;
	onGoToGroup: () => void;
	onInvite: () => void;
}) {
	const posts = room.posts.filter((post) => post.kind === kind);
	const empty = EMPTY[kind];
	const alone = room.members.length === 1;
	return (
		<div className="space-y-4">
			{!room.archived && <Composer key={kind} room={room} kind={kind} act={act} busy={busy} onShareNote={onShareNote} />}
			{posts.length === 0 ? (
				<div className={`${card} px-5 py-6`}>
					<empty.Icon size={24} strokeWidth={1.6} className="text-amber-800 dark:text-[#e5b664]" aria-hidden />
					<h2 className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">{empty.title}</h2>
					<p className="mt-1 leading-7 text-neutral-700 dark:text-[#d9d1c3]">{empty.text}</p>
					{alone && room.isOwner && !room.archived && (
						<div className="mt-4 flex flex-wrap gap-2">
							<button type="button" onClick={onInvite} className={secondaryButton}>
								<UserPlus size={17} aria-hidden /> Invite your group
							</button>
							{!room.plan && (
								<button type="button" onClick={onGoToGroup} className={`${quietButton} lg:hidden`}>
									Choose a reading plan
								</button>
							)}
						</div>
					)}
				</div>
			) : (
				posts.map((post) => <RoomPostCard key={post.id} room={room} post={post} act={act} busy={busy} />)
			)}
		</div>
	);
}

function Composer({ room, kind, act, busy, onShareNote }: { room: RoomView; kind: FeedKind; act: RoomAct; busy: string | null; onShareNote: () => void }) {
	const [body, setBody] = useState("");
	const [title, setTitle] = useState("");
	const [reference, setReference] = useState("");
	// A question or note is about a passage only sometimes; the field opens on request.
	const [withReference, setWithReference] = useState(kind === "passage");
	const [error, setError] = useState<string | null>(null);
	const key = `post-${kind}`;
	const sending = busy === key;
	const ready = kind === "passage" ? reference.trim().length > 0 : body.trim().length > 0;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!ready || busy) return;
		setError(null);
		const result = await act(key, `/api/beta/rooms/${room.id}/posts`, {
			method: "POST",
			body: { kind, body, reference: reference || null, ...(kind === "note" && { title: title || null }) },
		});
		if (result.ok) {
			setBody("");
			setTitle("");
			setReference("");
			setWithReference(kind === "passage");
		} else setError(result.error);
	};

	const referenceInput = (label: string, placeholder: string, optional: boolean) => (
		<label className="block">
			<span className="mb-1.5 block text-sm font-bold">
				{label} {optional && <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional)</span>}
			</span>
			<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} placeholder={placeholder} autoComplete="off" autoFocus={optional} className={field} />
		</label>
	);

	return (
		<form onSubmit={submit} className={`${card} space-y-3 p-4 sm:p-5`} aria-label={kind === "passage" ? "Share a passage" : kind === "question" ? "Ask the group a question" : "Add a shared note"}>
			{kind === "passage" && (
				<>
					{referenceInput("Passage", "Romans 5:1-11", false)}
					<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={PASSAGE_COMMENT_MAX} rows={2} placeholder="Why this passage? (optional)" aria-label="Why this passage" className={`${field} resize-y`} />
				</>
			)}
			{kind === "question" && (
				<>
					<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={QUESTION_MAX} rows={2} placeholder="Ask the group a question…" aria-label="Your question" className={`${field} resize-y`} />
					{withReference && referenceInput("About a passage", "Romans 5:1", true)}
				</>
			)}
			{kind === "note" && (
				<>
					<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={NOTE_TITLE_MAX} placeholder="Title (optional)" aria-label="Note title" className={field} />
					<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={NOTE_MAX} rows={3} placeholder="Write a note for the group…" aria-label="Your note" className={`${field} resize-y`} />
					{withReference && referenceInput("About a passage", "Romans 5", true)}
				</>
			)}
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="-ml-3 flex flex-wrap">
					{!withReference && (
						<button type="button" onClick={() => setWithReference(true)} className={quietButton}>
							<BookOpen size={17} aria-hidden /> Add a passage
						</button>
					)}
					{kind === "note" && (
						<button type="button" onClick={onShareNote} className={quietButton}>
							<NotebookPen size={17} aria-hidden /> Share one of your notes
						</button>
					)}
				</span>
				<button type="submit" disabled={!ready || busy !== null} className={primaryButton}>
					{sending ? "Posting…" : kind === "passage" ? "Share passage" : kind === "question" ? "Ask the group" : "Add note"}
				</button>
			</div>
		</form>
	);
}
