"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, HandHeart, Lock, Plus, UsersRound } from "lucide-react";
import { DESTINATION_TILE, IconTile } from "@/components/beta/visuals";
import { DISPLAY_NAME_MAX, ROOM_DESCRIPTION_MAX, ROOM_NAME_MAX } from "@/lib/beta/rooms/rooms-rules";
import { planWeekOf } from "@/lib/beta/groups/groups-rules";
import type { RoomSummary } from "@/lib/beta/rooms/rooms";
import type { GroupView } from "@/lib/beta/groups/groups";
import { roomFetch } from "@/components/beta/rooms/room-client";
import { ErrorNote, RelativeTime, card, eyebrow, field, primaryButton, secondaryButton } from "@/components/beta/rooms/room-ui";

type FromStudy = { title: string; body: string; group: string } | null;

export default function GroupsHome({ initialGroups, fromStudy }: { initialGroups: RoomSummary[]; fromStudy: FromStudy }) {
	const open = initialGroups.filter((group) => !group.archived);
	const archived = initialGroups.filter((group) => group.archived);
	const [creating, setCreating] = useState(open.length === 0);

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/together" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Together
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={UsersRound} tone={DESTINATION_TILE.together} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">SureWord Groups</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Study, pray and grow as a small group</p>
				</div>
			</header>

			{fromStudy && (
				<section aria-labelledby="groups-from-study" className={`${card} mt-6 p-5`}>
					<p id="groups-from-study" className={eyebrow}>
						From your study
					</p>
					<h2 className="mt-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight [overflow-wrap:anywhere]">{fromStudy.title}</h2>
					{fromStudy.body && <p className="mt-1 whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{fromStudy.body}</p>}
					<p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
						You wrote this in {fromStudy.group}, which you are no longer in. This copy is yours and stays in your study.
					</p>
				</section>
			)}

			<p className="mt-5 text-[17px] leading-7">
				A home for your small group or Bible class: a reading plan with each week&rsquo;s passage, questions to talk through that your leaders prepare with SureWord&rsquo;s help, a guided session for the meeting, and a prayer circle.
			</p>
			<p className="mt-3 flex gap-2.5 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
				<Lock size={16} className="mt-1 shrink-0" aria-hidden />
				Your own notes, prayer list and conversations with SureWord stay private. Nothing from them reaches a group unless you share it there yourself.
			</p>

			<section aria-labelledby="groups-yours" className="mt-8">
				<div className="flex items-end justify-between gap-3">
					<h2 id="groups-yours" className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">
						Your groups
					</h2>
					{!creating && (
						<button type="button" onClick={() => setCreating(true)} className={secondaryButton}>
							<Plus size={17} aria-hidden /> New group
						</button>
					)}
				</div>

				{creating && <StartGroup onCancel={open.length > 0 ? () => setCreating(false) : undefined} />}

				{open.length === 0 ? (
					<p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
						You are not in a group yet. Start one above and send the invite link to the people you meet with, or open an invite link someone sent you.
					</p>
				) : (
					<ul className="mt-4 grid grid-cols-1 gap-3">
						{open.map((group) => (
							<li key={group.id}>
								<GroupRow group={group} />
							</li>
						))}
					</ul>
				)}
			</section>

			{archived.length > 0 && (
				<section aria-labelledby="groups-archived" className="mt-9">
					<h2 id="groups-archived" className={eyebrow}>
						Archived
					</h2>
					<ul className="mt-3 grid grid-cols-1 gap-3">
						{archived.map((group) => (
							<li key={group.id}>
								<GroupRow group={group} />
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}

function GroupRow({ group }: { group: RoomSummary }) {
	const badge = group.role === "owner" ? "Owner" : group.role === "leader" ? "Leader" : null;
	return (
		<Link
			href={`/beta/together/groups/${group.id}`}
			className={`${card} group flex min-h-24 items-center gap-4 px-5 py-4 transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`}
		>
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<span className="font-[family-name:var(--font-cormorant)] text-[25px] font-semibold leading-tight [overflow-wrap:anywhere]">{group.name}</span>
					{badge && <span className="rounded-full border border-black/10 px-2.5 py-0.5 text-xs font-bold text-neutral-600 dark:border-white/10 dark:text-[#b3ad9e]">{badge}</span>}
					{group.archived && (
						<span className="rounded-full border border-black/10 bg-black/[.04] px-2.5 py-0.5 text-xs font-bold text-neutral-600 dark:border-white/10 dark:bg-white/[.04] dark:text-[#bbb3a7]">Archived</span>
					)}
				</span>
				{group.description && <span className="mt-0.5 block truncate text-sm text-neutral-700 dark:text-[#d9d1c3]">{group.description}</span>}
				<span className="mt-1.5 block text-sm text-neutral-600 dark:text-[#bbb3a7]">
					{group.memberCount === 1 ? "Just you so far" : `${group.memberCount} members`}
					{group.plan && ` · ${group.plan.title}, week ${planWeekOf(group.plan.todayDay)}`}
					{" · active "}
					<RelativeTime iso={group.lastActivityAt} />
				</span>
			</span>
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 text-neutral-700 transition-transform group-hover:translate-x-0.5 dark:border-white/15 dark:text-neutral-200" aria-hidden>
				<ArrowRight size={20} />
			</span>
		</Link>
	);
}

function StartGroup({ onCancel }: { onCancel?: () => void }) {
	const router = useRouter();
	const { user } = useUser();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
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
		const result = await roomFetch<{ group: GroupView }>("/api/beta/groups", { method: "POST", body: { name, description, displayName: shownName } });
		if (result.ok) {
			router.push(`/beta/together/groups/${result.data.group.room.id}`);
			return;
		}
		setError(result.error);
		setBusy(false);
	};

	return (
		<form onSubmit={submit} className={`${card} mt-4 space-y-4 p-5`} aria-labelledby="groups-new">
			<h3 id="groups-new" className={`${eyebrow} flex items-center gap-2`}>
				<HandHeart size={15} aria-hidden /> Start a group
			</h3>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Group name</span>
				<input value={name} onChange={(event) => setName(event.target.value)} maxLength={ROOM_NAME_MAX} required placeholder="Tuesday night small group" className={field} />
			</label>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">
					What is the group studying? <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">(optional)</span>
				</span>
				<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={ROOM_DESCRIPTION_MAX} rows={2} placeholder="Working through the letter of James this autumn" className={`${field} resize-none`} />
			</label>
			<label className="block">
				<span className="mb-1.5 block text-sm font-bold">Your name in the group</span>
				<input value={shownName} onChange={(event) => setDisplayName(event.target.value)} maxLength={DISPLAY_NAME_MAX} required autoComplete="given-name" className={field} />
			</label>
			<p className="text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">You lead the group you start. You can name other leaders once they join.</p>
			{error && <ErrorNote message={error} onDismiss={() => setError(null)} />}
			<div className="flex flex-wrap items-center gap-2">
				<button type="submit" disabled={busy || !name.trim() || !shownName.trim()} className={primaryButton}>
					{busy ? "Starting…" : "Start the group"}
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
