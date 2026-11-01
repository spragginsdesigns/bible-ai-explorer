"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, HeartHandshake, Lock, Plus } from "lucide-react";
import { DESTINATION_TILE, IconTile } from "@/components/beta/visuals";
import { DISPLAY_NAME_MAX, ROOM_NAME_MAX } from "@/lib/beta/rooms/rooms-rules";
import type { RoomSummary } from "@/lib/beta/rooms/rooms";
import type { FamilyView } from "@/lib/beta/family/family";
import { roomFetch } from "@/components/beta/rooms/room-client";
import { ErrorNote, RelativeTime, card, eyebrow, field, primaryButton, secondaryButton } from "@/components/beta/rooms/room-ui";

/** SureWord Family's front page: the families you are a parent in, and a new one (docs/beta/family.md). */
export default function FamilyHome({ initialFamilies }: { initialFamilies: RoomSummary[] }) {
	const open = initialFamilies.filter((family) => !family.archived);
	const archived = initialFamilies.filter((family) => family.archived);
	const [creating, setCreating] = useState(open.length === 0);

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/together" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Together
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={HeartHandshake} tone={DESTINATION_TILE.together} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">SureWord Family</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Grow in the Word together as a household</p>
				</div>
			</header>

			<p className="mt-5 text-[17px] leading-7">
				One space for your household. Start a family, invite the other parent with a link, and add your children from the profiles you made in SureWord Kids.
			</p>
			<p className="mt-3 flex gap-2.5 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
				<Lock size={16} className="mt-1 shrink-0" aria-hidden />
				Your own notes, prayer list and conversations with SureWord stay private. Nothing from them reaches your family unless you share it there yourself.
			</p>

			<section aria-labelledby="family-yours" className="mt-8">
				<div className="flex items-end justify-between gap-3">
					<h2 id="family-yours" className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">
						Your family
					</h2>
					{!creating && (
						<button type="button" onClick={() => setCreating(true)} className={secondaryButton}>
							<Plus size={17} aria-hidden /> New family
						</button>
					)}
				</div>

				{creating && <StartFamily onCancel={open.length > 0 ? () => setCreating(false) : undefined} />}

				{open.length === 0 ? (
					<p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
						You are not in a family yet. Start one above and send the invite link to the other parent, or open an invite link they sent you.
					</p>
				) : (
					<ul className="mt-4 grid grid-cols-1 gap-3">
						{open.map((family) => (
							<li key={family.id}>
								<FamilyRow family={family} />
							</li>
						))}
					</ul>
				)}
			</section>

			{archived.length > 0 && (
				<section aria-labelledby="family-archived" className="mt-9">
					<h2 id="family-archived" className={eyebrow}>
						Archived
					</h2>
					<ul className="mt-3 grid grid-cols-1 gap-3">
						{archived.map((family) => (
							<li key={family.id}>
								<FamilyRow family={family} />
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}

function FamilyRow({ family }: { family: RoomSummary }) {
	return (
		<Link
			href={`/beta/together/family/${family.id}`}
			className={`${card} group flex min-h-24 items-center gap-4 px-5 py-4 transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`}
		>
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<span className="font-[family-name:var(--font-cormorant)] text-[25px] font-semibold leading-tight [overflow-wrap:anywhere]">{family.name}</span>
					{family.archived && (
						<span className="rounded-full border border-black/10 bg-black/[.04] px-2.5 py-0.5 text-xs font-bold text-neutral-600 dark:border-white/10 dark:bg-white/[.04] dark:text-[#bbb3a7]">Archived</span>
					)}
				</span>
				<span className="mt-1.5 block text-sm text-neutral-600 dark:text-[#bbb3a7]">
					{family.memberCount === 1 ? "Just you so far" : `${family.memberCount} parents`}
					{" · active "}
					<RelativeTime iso={family.lastActivityAt} />
				</span>
			</span>
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 text-neutral-700 transition-transform group-hover:translate-x-0.5 dark:border-white/15 dark:text-neutral-200" aria-hidden>
				<ArrowRight size={20} />
			</span>
		</Link>
	);
}

function StartFamily({ onCancel }: { onCancel?: () => void }) {
	const router = useRouter();
	const { user } = useUser();
	const [name, setName] = useState("");
	const [displayName, setDisplayName] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Until the person edits it, the name they go by is their first name.
	const shownName = displayName ?? user?.firstName?.trim() ?? "";

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		const result = await roomFetch<{ family: FamilyView }>("/api/beta/family", { method: "POST", body: { name, displayName: shownName } });
		if (result.ok) {
			router.push(`/beta/together/family/${result.data.family.room.id}`);
			return;
		}
		setError(result.error);
		setBusy(false);
	};

	return (
		<form onSubmit={submit} className={`${card} mt-4 space-y-4 p-5`} aria-labelledby="family-new">
			<h3 id="family-new" className={`${eyebrow} flex items-center gap-2`}>
				<HeartHandshake size={15} aria-hidden /> Start a family
			</h3>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Family name</span>
				<input value={name} onChange={(event) => setName(event.target.value)} maxLength={ROOM_NAME_MAX} required placeholder="The Millers" className={field} />
			</label>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Your name in the family</span>
				<input value={shownName} onChange={(event) => setDisplayName(event.target.value)} maxLength={DISPLAY_NAME_MAX} required autoComplete="given-name" placeholder="Mom, Dad or your first name" className={field} />
			</label>
			<p className="text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">You can invite the other parent and add your children next.</p>
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap items-center gap-2">
				<button type="submit" disabled={busy || !name.trim() || !shownName.trim()} className={primaryButton}>
					{busy ? "Starting…" : "Start the family"}
				</button>
				{onCancel && (
					<button type="button" onClick={onCancel} className={secondaryButton}>
						Cancel
					</button>
				)}
			</div>
		</form>
	);
}
