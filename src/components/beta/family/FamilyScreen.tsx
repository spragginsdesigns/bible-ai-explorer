"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Archive, ArrowLeft, Baby, Lock, Plus, UserPlus } from "lucide-react";
import type { FamilyView } from "@/lib/beta/family/family";
import type { FamilyChildView } from "@/lib/beta/family/family-rules";
import type { MemberView } from "@/lib/beta/rooms/rooms-rules";
import { roomFetch, type RoomResult } from "@/components/beta/rooms/room-client";
import { Avatar, ErrorNote, LocalDate, card, dangerButton, eyebrow, quietButton, secondaryButton } from "@/components/beta/rooms/room-ui";
import { InviteSheet } from "@/components/beta/rooms/RoomSheets";
import { RoomSettings } from "@/components/beta/rooms/RoomGroupPanel";

type FamilyAct = (key: string, path: string, init?: { method?: string; body?: unknown }) => Promise<RoomResult<{ family: FamilyView }>>;

/** One family, for its parents (docs/beta/family.md). */
export default function FamilyScreen({ initialFamily }: { initialFamily: FamilyView }) {
	const { userId } = useAuth();
	// A different account must never see the previous one's family, even briefly.
	return <FamilyScreenContent key={userId ?? "guest"} initialFamily={initialFamily} />;
}

function FamilyScreenContent({ initialFamily }: { initialFamily: FamilyView }) {
	const router = useRouter();
	const [family, setFamily] = useState(initialFamily);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [gone, setGone] = useState(false);
	const [inviting, setInviting] = useState(false);
	const busyRef = useRef(false);
	// Bumped by every change, so a refresh that left before it never lands after it.
	const changeSeq = useRef(0);
	const room = family.room;
	const base = `/api/beta/family/${room.id}`;

	const act: FamilyAct = useCallback(
		async (key, path, init) => {
			changeSeq.current += 1;
			busyRef.current = true;
			setBusy(key);
			setError(null);
			let result = await roomFetch<{ family: FamilyView }>(path, init);
			if (result.ok && result.data.family) setFamily(result.data.family);
			else if (!result.ok && result.status === 404) {
				// A child or parent someone else just removed is a 404 too; only the
				// family itself answering 404 means you are no longer in it.
				const check = await roomFetch<{ family: FamilyView }>(base);
				if (check.ok) {
					setFamily(check.data.family);
					result = { ...result, error: "That is no longer in the family." };
				} else if (check.status === 404) setGone(true);
			}
			busyRef.current = false;
			setBusy(null);
			return result;
		},
		[base],
	);

	// The other parent adds children and joins while you are away: refresh on return.
	useEffect(() => {
		if (gone) return;
		let stopped = false;
		let refreshing = false;
		const refresh = async () => {
			if (stopped || refreshing || busyRef.current || document.visibilityState !== "visible") return;
			const seq = changeSeq.current;
			refreshing = true;
			const result = await roomFetch<{ family: FamilyView }>(base);
			refreshing = false;
			if (stopped || busyRef.current || seq !== changeSeq.current) return;
			if (result.ok) setFamily(result.data.family);
			else if (result.status === 404) setGone(true);
		};
		const onVisible = () => void refresh();
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			stopped = true;
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, [base, gone]);

	const leave = async () => {
		if (busyRef.current) return;
		changeSeq.current += 1;
		busyRef.current = true;
		setBusy(`remove-${room.you.memberId}`);
		setError(null);
		const result = await roomFetch<{ left?: boolean }>(`${base}/members/${room.you.memberId}`, { method: "DELETE" });
		// Stay busy while the page changes, so nothing else is sent from a family you have left.
		if (result.ok) return router.push("/beta/together/family");
		busyRef.current = false;
		setBusy(null);
		setError(result.error);
	};

	if (gone) {
		return (
			<main className="mx-auto w-full max-w-xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-10 lg:px-8">
				<section className={`${card} p-6`}>
					<h1 className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">You are no longer in this family</h1>
					<p className="mt-2 leading-7 text-neutral-700 dark:text-[#d9d1c3]">Its owner may have removed you. Your own notes, prayer list and your children&rsquo;s profiles in SureWord Kids are untouched.</p>
					<Link href="/beta/together/family" className={`${secondaryButton} mt-5`}>
						Go to SureWord Family
					</Link>
				</section>
			</main>
		);
	}

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/together/family" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> SureWord Family
			</Link>

			<header className="mt-3">
				<p className={eyebrow}>Your family</p>
				<h1 className="mt-1 font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02] [overflow-wrap:anywhere]">{room.name}</h1>
				{room.description && <p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">{room.description}</p>}
				{room.archived && (
					<p className="mt-3 inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[.04] px-3 py-1 text-sm font-bold text-neutral-700 dark:border-white/10 dark:bg-white/[.04] dark:text-[#d9d1c3]">
						<Archive size={15} aria-hidden /> Archived
					</p>
				)}
			</header>

			{error && (
				<div className="mt-4">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			<div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
				<Children family={family} act={act} busy={busy} onError={setError} />
				<div className="space-y-4">
					<Parents family={family} act={act} busy={busy} onInvite={() => setInviting(true)} onLeave={() => void leave()} onError={setError} />
					<section aria-labelledby="family-private" className={`${card} p-5`}>
						<h2 id="family-private" className={`${eyebrow} flex items-center gap-2`}>
							<Lock size={14} aria-hidden /> Your private study
						</h2>
						<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
							Only you see this. Your notes, prayer list and conversations with SureWord never appear in the family, and the other parent never sees them.
						</p>
					</section>
					{room.isOwner && <RoomSettings room={room} act={act} busy={busy} onError={setError} purpose="family" />}
				</div>
			</div>

			{inviting && room.isOwner && <InviteSheet room={room} act={act} busy={busy} purpose="family" onClose={() => setInviting(false)} />}
		</main>
	);
}

function Children({ family, act, busy, onError }: { family: FamilyView; act: FamilyAct; busy: string | null; onError: (message: string) => void }) {
	const room = family.room;
	const base = `/api/beta/family/${room.id}`;
	const [choosing, setChoosing] = useState(false);
	const add = async (childId: string) => {
		const result = await act(`add-${childId}`, `${base}/children`, { method: "POST", body: { childId } });
		if (result.ok) setChoosing(false);
		else onError(result.error);
	};

	return (
		<section aria-labelledby="family-children" className={`${card} p-5`}>
			<div className="flex items-center justify-between gap-2">
				<h2 id="family-children" className={eyebrow}>
					Children · {family.children.length}
				</h2>
				{!room.archived && family.addable.length > 0 && !choosing && (
					<button type="button" onClick={() => setChoosing(true)} className={`${quietButton} -mr-3`}>
						<Plus size={16} aria-hidden /> Add a child
					</button>
				)}
			</div>

			{family.children.length === 0 ? (
				<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">No children in the family yet. Add them from the profiles you made in SureWord Kids.</p>
			) : (
				<ul className="mt-1 divide-y divide-black/[.06] dark:divide-white/[.06]">
					{family.children.map((child) => (
						<ChildRow key={child.linkId} child={child} family={family} act={act} busy={busy} onError={onError} />
					))}
				</ul>
			)}

			{choosing && (
				<div className="mt-3 rounded-2xl bg-black/[.035] p-4 dark:bg-white/[.04]">
					<p className="text-sm font-bold">Choose from your children in SureWord Kids</p>
					<ul className="mt-2 grid grid-cols-1 gap-2">
						{family.addable.map((child) => (
							<li key={child.id}>
								<button type="button" onClick={() => void add(child.id)} disabled={busy !== null} className={`${secondaryButton} w-full justify-between`}>
									<span className="truncate">
										{child.name} <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]">· {child.ageLabel}</span>
									</span>
									<span>{busy === `add-${child.id}` ? "Adding…" : "Add"}</span>
								</button>
							</li>
						))}
					</ul>
					<button type="button" onClick={() => setChoosing(false)} className={`${quietButton} -ml-3 mt-1`}>
						Cancel
					</button>
				</div>
			)}

			{!room.archived && family.addable.length === 0 && (
				<p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
					{family.yourProfiles === 0 ? "Make a profile for each of your children in SureWord Kids, then add them here." : "Every child profile you made is in this family. Make another in SureWord Kids to add them."}{" "}
					<Link href="/beta/together/kids" className="font-bold text-amber-800 underline-offset-4 hover:underline dark:text-[#e5b664]">
						Open SureWord Kids
					</Link>
				</p>
			)}

			<p className="mt-3 flex gap-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">
				<Baby size={14} className="mt-0.5 shrink-0" aria-hidden />
				Children never get an account. A child&rsquo;s profile, just a first name and an age band, stays on the account of the parent who made it in SureWord Kids, and the family shows it to its parents.
			</p>
		</section>
	);
}

function ChildRow({ child, family, act, busy, onError }: { child: FamilyChildView; family: FamilyView; act: FamilyAct; busy: string | null; onError: (message: string) => void }) {
	const [confirming, setConfirming] = useState(false);
	const remove = async () => {
		const result = await act(`unlink-${child.linkId}`, `/api/beta/family/${family.room.id}/children/${child.linkId}`, { method: "DELETE" });
		if (!result.ok) onError(result.error);
	};
	return (
		<li className="py-2.5">
			<div className="flex items-center gap-3">
				<Avatar name={child.name} size="sm" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-bold">{child.name}</span>
					<span className="block text-xs text-neutral-600 dark:text-[#bbb3a7]">
						{child.ageLabel} · added by {child.isYours ? "you" : child.addedBy}
					</span>
				</span>
				{child.canRemove && !family.room.archived && !confirming && (
					<button type="button" onClick={() => setConfirming(true)} className={quietButton}>
						Remove
					</button>
				)}
			</div>
			{confirming && (
				<div className="mt-2 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 dark:bg-white/[.04]">
					<p>Take {child.name} out of the family? {child.isYours ? "Their" : `${child.addedBy}'s`} profile and stars in SureWord Kids stay as they are.</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button type="button" onClick={() => void remove()} disabled={busy !== null} className={dangerButton}>
							{busy === `unlink-${child.linkId}` ? "Removing…" : "Remove from the family"}
						</button>
						<button type="button" onClick={() => setConfirming(false)} className={quietButton}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</li>
	);
}

function Parents({
	family,
	act,
	busy,
	onInvite,
	onLeave,
	onError,
}: {
	family: FamilyView;
	act: FamilyAct;
	busy: string | null;
	onInvite: () => void;
	onLeave: () => void;
	onError: (message: string) => void;
}) {
	const room = family.room;
	return (
		<section aria-labelledby="family-parents" className={`${card} p-5`}>
			<div className="flex items-center justify-between gap-2">
				<h2 id="family-parents" className={eyebrow}>
					Parents · {room.members.length}
				</h2>
				{room.isOwner && !room.archived && (
					<button type="button" onClick={onInvite} className={`${quietButton} -mr-3`}>
						<UserPlus size={16} aria-hidden /> Invite
					</button>
				)}
			</div>
			<ul className="mt-1 divide-y divide-black/[.06] dark:divide-white/[.06]">
				{room.members.map((member) => (
					<ParentRow key={member.id} member={member} family={family} act={act} busy={busy} onLeave={onLeave} onError={onError} />
				))}
			</ul>
			{room.isOwner && room.members.length === 1 && !room.archived && (
				<p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">Invite the other parent with a link. They join with their own SureWord account.</p>
			)}
		</section>
	);
}

function ParentRow({
	member,
	family,
	act,
	busy,
	onLeave,
	onError,
}: {
	member: MemberView;
	family: FamilyView;
	act: FamilyAct;
	busy: string | null;
	onLeave: () => void;
	onError: (message: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const remove = async () => {
		if (member.action === "leave") return onLeave();
		const result = await act(`remove-${member.id}`, `/api/beta/family/${family.room.id}/members/${member.id}`, { method: "DELETE" });
		if (!result.ok) onError(result.error);
	};
	return (
		<li className="py-2.5">
			<div className="flex items-center gap-3">
				<Avatar name={member.displayName} size="sm" />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-bold">
						{member.displayName}
						{member.isYou && <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]"> (you)</span>}
					</span>
					<span className="block text-xs text-neutral-600 dark:text-[#bbb3a7]">
						{member.role === "owner" ? "Started the family" : "Joined"} <LocalDate iso={member.joinedAt} />
					</span>
				</span>
				{member.action && !confirming && (
					<button type="button" onClick={() => setConfirming(true)} className={quietButton}>
						{member.action === "leave" ? "Leave" : "Remove"}
					</button>
				)}
			</div>
			{confirming && (
				<div className="mt-2 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 dark:bg-white/[.04]">
					<p>
						{member.action === "leave"
							? "Leave this family? The children you added leave it with you. Their profiles in SureWord Kids, your notes and your prayer list stay yours."
							: `Remove ${member.displayName}? The children they added leave the family with them; their profiles stay on ${member.displayName}'s account.${family.room.inviteToken ? " The invite link is replaced so they cannot rejoin with it." : ""}`}
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button type="button" onClick={() => void remove()} disabled={busy !== null} className={dangerButton}>
							{busy === `remove-${member.id}` ? (member.action === "leave" ? "Leaving…" : "Removing…") : member.action === "leave" ? "Leave the family" : "Remove"}
						</button>
						<button type="button" onClick={() => setConfirming(false)} className={quietButton}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</li>
	);
}
