"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, Link2Off, Lock, Users } from "lucide-react";
import { DESTINATION_TILE, IconTile } from "@/components/beta/visuals";
import { DISPLAY_NAME_MAX } from "@/lib/beta/rooms/rooms-rules";
import type { InvitePreview } from "@/lib/beta/rooms/rooms";
import { roomFetch } from "./room-client";
import { ErrorNote, card, eyebrow, field, primaryButton, secondaryButton } from "./room-ui";

export default function JoinRoom({ token, invite }: { token: string; invite: InvitePreview | null }) {
	const router = useRouter();
	const { user } = useUser();
	const [displayName, setDisplayName] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const shownName = displayName ?? user?.firstName?.trim() ?? "";

	const join = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		const result = await roomFetch<{ roomId: string }>(`/api/beta/rooms/join/${encodeURIComponent(token)}`, { method: "POST", body: { displayName: shownName } });
		if (result.ok) {
			router.push(`/beta/study/rooms/${result.data.roomId}`);
			return;
		}
		setError(result.status === 404 ? "This invite link stopped working while you were here. Ask for a new one." : result.error);
		setBusy(false);
	};

	return (
		<main className="mx-auto w-full max-w-xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study/rooms" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study Rooms
			</Link>

			{!invite ? (
				<section className={`${card} mt-4 p-6`} aria-labelledby="join-gone">
					<IconTile Icon={Link2Off} tone={DESTINATION_TILE.study} />
					<h1 id="join-gone" className="mt-4 font-[family-name:var(--font-cormorant)] text-[32px] font-semibold leading-tight">
						This invite link no longer works
					</h1>
					<p className="mt-2 leading-7 text-neutral-700 dark:text-[#d9d1c3]">
						The room&rsquo;s owner turned it off or made a new one, or the room was archived. Ask the person who sent it for a fresh link.
					</p>
					<Link href="/beta/study/rooms" className={`${secondaryButton} mt-5`}>
						Go to your rooms
					</Link>
				</section>
			) : (
				<form onSubmit={join} className={`${card} mt-4 p-6`} aria-labelledby="join-title">
					<p className={eyebrow}>You&rsquo;re invited to a Study Room</p>
					<h1 id="join-title" className="mt-2 font-[family-name:var(--font-cormorant)] text-[clamp(2rem,8vw,2.6rem)] font-semibold leading-[1.05]">
						{invite.name}
					</h1>
					{invite.description && <p className="mt-2 text-[17px] leading-7">{invite.description}</p>}
					<p className="mt-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]">
						<Users size={16} aria-hidden />
						{invite.ownerName}&rsquo;s room · {invite.memberCount === 1 ? "1 member" : `${invite.memberCount} members`}
						{invite.planTitle && ` · reading ${invite.planTitle}`}
					</p>

					<p className="mt-5 flex gap-2.5 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 text-neutral-700 dark:bg-white/[.04] dark:text-[#d9d1c3]">
						<Lock size={16} className="mt-1 shrink-0" aria-hidden />
						Members see what you post in the room and the name below. Your notes, prayers and conversations with SureWord stay private unless you share one.
					</p>

					{invite.full ? (
						<p className="mt-5 text-sm font-bold text-red-800 dark:text-red-300">This room is full. Ask its owner to make space.</p>
					) : (
						<>
							<label className="mt-5 block">
								<span className="mb-1.5 block text-sm font-bold">Your name in the room</span>
								<input value={shownName} onChange={(event) => setDisplayName(event.target.value)} maxLength={DISPLAY_NAME_MAX} required autoComplete="given-name" className={field} />
							</label>
							{error && (
								<div className="mt-4">
									<ErrorNote message={error} onDismiss={() => setError(null)} />
								</div>
							)}
							<button type="submit" disabled={busy || !shownName.trim()} className={`${primaryButton} mt-5 w-full sm:w-auto`}>
								{busy ? "Joining…" : "Join the room"}
							</button>
						</>
					)}
				</form>
			)}
		</main>
	);
}
