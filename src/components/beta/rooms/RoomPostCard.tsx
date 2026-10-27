"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, NotebookPen, Trash2 } from "lucide-react";
import type { RoomView } from "@/lib/beta/rooms/rooms";
import { REPLY_MAX, type PostView } from "@/lib/beta/rooms/rooms-rules";
import type { RoomAct } from "./RoomScreen";
import { Avatar, ErrorNote, RelativeTime, card, quietButton } from "./room-ui";

/** A long shared note opens folded to about this many characters. */
const NOTE_FOLD = 700;

function PassageChip({ reference, href }: { reference: string; href: string }) {
	return (
		<Link href={href} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-amber-800/20 bg-amber-500/[.08] px-3 text-xs font-bold text-amber-900 hover:bg-amber-500/[.16] dark:border-amber-200/20 dark:text-amber-200">
			<BookOpen size={13} aria-hidden /> {reference}
		</Link>
	);
}

function OwnerBadge() {
	return <span className="shrink-0 rounded-full border border-black/10 px-2 text-xs font-bold text-neutral-600 dark:border-white/10 dark:text-[#b3ad9e]">Owner</span>;
}

function Byline({ post }: { post: PostView }) {
	return (
		<span className="flex min-w-0 items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
			<Avatar name={post.author.displayName} size="sm" />
			<span className="truncate font-bold text-neutral-800 dark:text-[#e9dfcb]">{post.author.isYou ? "You" : post.author.displayName}</span>
			{post.author.isOwner && !post.author.isYou && <OwnerBadge />}
			<span aria-hidden>·</span>
			<RelativeTime iso={post.createdAt} className="shrink-0" />
		</span>
	);
}

function RemoveButton({ label, busy, onRemove }: { label: string; busy: boolean; onRemove: () => void }) {
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
				{busy ? "Removing…" : "Remove"}
			</button>
			<button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-3 font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				Keep
			</button>
		</span>
	);
}

export default function RoomPostCard({ room, post, act, busy }: { room: RoomView; post: PostView; act: RoomAct; busy: string | null }) {
	const [unfolded, setUnfolded] = useState(false);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const remove = async (id: string) => {
		setRemoveError(null);
		const result = await act(`delete-${id}`, `/api/beta/rooms/${room.id}/posts/${id}`, { method: "DELETE" });
		if (!result.ok) setRemoveError(result.error);
	};
	const folded = post.kind === "note" && !unfolded && post.body.length > NOTE_FOLD;

	return (
		<article className={`${card} px-4 py-4 sm:px-5`} aria-label={post.kind === "passage" ? `Passage ${post.passage?.reference ?? ""}` : post.kind === "question" ? "Question" : "Shared note"}>
			{/* On a phone the passage chip wraps under the byline rather than squeezing the author's name. */}
			<div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
				<Byline post={post} />
				<span className="ml-auto flex items-center gap-1">
					{post.kind !== "passage" && post.passage && <PassageChip reference={post.passage.reference} href={post.passage.href} />}
					{post.canDelete && <RemoveButton label={post.kind === "question" ? "Remove this question" : "Remove this"} busy={busy === `delete-${post.id}`} onRemove={() => void remove(post.id)} />}
				</span>
			</div>

			{post.kind === "passage" && post.passage && (
				<div className="mt-3">
					<div className="flex flex-wrap items-baseline justify-between gap-x-3">
						<h3 className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight">{post.passage.reference}</h3>
						<Link href={post.passage.href} className="flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
							<BookOpen size={16} aria-hidden /> Open in the Bible
						</Link>
					</div>
					<p className="mt-1 font-[family-name:var(--font-cormorant)] text-[20px] leading-[1.55]">
						{post.passage.verses.map(({ verse, text }) => (
							<span key={verse}>
								<sup className="relative -top-[0.5em] mr-0.5 align-baseline font-sans text-xs font-bold text-amber-800/80 dark:text-[#e5b664]/80">{verse}</sup>
								{text}{" "}
							</span>
						))}
					</p>
					{post.passage.truncated && (
						<Link href={post.passage.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
							Continue in the Bible
						</Link>
					)}
					<p className="mt-1 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">KJV</p>
					{post.body && <p className="mt-3 whitespace-pre-line leading-7">{post.body}</p>}
				</div>
			)}

			{post.kind === "question" && <p className="mt-3 whitespace-pre-line font-[family-name:var(--font-cormorant)] text-[23px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{post.body}</p>}

			{post.kind === "note" && (
				<div className="mt-3">
					{post.sharedNote && (
						<p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
							<NotebookPen size={13} aria-hidden /> Shared from {post.author.isYou ? "your" : `${post.author.displayName}'s`} notes
						</p>
					)}
					{post.title && <h3 className="font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight [overflow-wrap:anywhere]">{post.title}</h3>}
					<p className="mt-1 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{folded ? `${post.body.slice(0, NOTE_FOLD).trimEnd()}…` : post.body}</p>
					{post.body.length > NOTE_FOLD && (
						<button type="button" onClick={() => setUnfolded((value) => !value)} className={`${quietButton} -ml-3 mt-1`}>
							{unfolded ? "Show less" : "Show all"}
						</button>
					)}
				</div>
			)}

			{removeError && (
				<div className="mt-3">
					<ErrorNote message={removeError} onDismiss={() => setRemoveError(null)} />
				</div>
			)}

			{(post.replies.length > 0 || !room.archived) && (
				<div className="mt-4 border-t border-black/[.08] pt-3 dark:border-white/[.08]">
					{post.replies.length > 0 && (
						<ul className="space-y-3" aria-label="Replies">
							{post.replies.map((reply) => (
								<li key={reply.id} className="border-l-2 border-amber-700/25 pl-3 dark:border-amber-300/25">
									<div className="flex items-start justify-between gap-2">
										<span className="flex items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
											<span className="font-bold text-neutral-800 dark:text-[#e9dfcb]">{reply.author.isYou ? "You" : reply.author.displayName}</span>
											{reply.author.isOwner && !reply.author.isYou && <OwnerBadge />}
											<span aria-hidden>·</span>
											<RelativeTime iso={reply.createdAt} />
										</span>
										{reply.canDelete && <RemoveButton label="Remove this reply" busy={busy === `delete-${reply.id}`} onRemove={() => void remove(reply.id)} />}
									</div>
									<p className="-mt-1 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{reply.body}</p>
								</li>
							))}
						</ul>
					)}
					{!room.archived && <ReplyBox room={room} post={post} act={act} busy={busy} />}
				</div>
			)}
		</article>
	);
}

function ReplyBox({ room, post, act, busy }: { room: RoomView; post: PostView; act: RoomAct; busy: string | null }) {
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const key = `reply-${post.id}`;
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!body.trim() || busy) return;
		setError(null);
		const result = await act(key, `/api/beta/rooms/${room.id}/posts`, { method: "POST", body: { kind: "reply", parentId: post.id, body } });
		if (result.ok) setBody("");
		else setError(result.error);
	};
	return (
		<form onSubmit={submit} className={post.replies.length > 0 ? "mt-3" : undefined}>
			<div className="flex items-end gap-2">
				<label className="sr-only" htmlFor={`reply-${post.id}`}>
					Reply
				</label>
				<textarea
					id={`reply-${post.id}`}
					value={body}
					onChange={(event) => setBody(event.target.value)}
					maxLength={REPLY_MAX}
					rows={1}
					placeholder={post.kind === "question" ? "Write a reply…" : "Say something about this…"}
					className="min-h-11 flex-1 resize-none rounded-[22px] border border-black/10 bg-white/80 px-4 py-2.5 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/40"
				/>
				<button type="submit" disabled={!body.trim() || busy !== null} aria-label="Send reply" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118] transition-opacity disabled:opacity-35">
					<ArrowUp size={20} aria-hidden />
				</button>
			</div>
			{error && (
				<div className="mt-2">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}
		</form>
	);
}
