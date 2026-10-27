"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, UserPlus } from "lucide-react";
import type { GroupView } from "@/lib/beta/groups/groups";
import type { MemberView } from "@/lib/beta/rooms/rooms-rules";
import { Avatar, LocalDate, card, dangerButton, eyebrow, quietButton } from "@/components/beta/rooms/room-ui";
import { ReadingTogether, RoomSettings } from "@/components/beta/rooms/RoomGroupPanel";
import type { GroupAct } from "./GroupScreen";
import { RoleBadge } from "./group-ui";

interface Props {
	group: GroupView;
	act: GroupAct;
	busy: string | null;
	onInvite: () => void;
	onFollow: () => void;
	onLeave: () => void;
	onError: (message: string) => void;
}

/** The group itself: its reading plan by week, its members and leaders, your private study, and the owner's settings. */
export default function GroupPanel(props: Props) {
	const { group, act, busy, onFollow, onError } = props;
	const room = group.room;
	return (
		<div className="space-y-4">
			<ReadingTogether room={room} act={act} busy={busy} onFollow={onFollow} onError={onError} purpose="group">
				<PlanWeeks group={group} />
			</ReadingTogether>
			<Members {...props} />
			<section aria-labelledby="group-private" className={`${card} p-5`}>
				<h2 id="group-private" className={`${eyebrow} flex items-center gap-2`}>
					<Lock size={14} aria-hidden /> Your private study
				</h2>
				<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					Only you see this. Your notes, prayer list and conversations with SureWord never appear in the group unless you share one. What you write here, your answers, questions, session notes and prayer requests, is also kept in your own study, so the Knowledge Vault can find it later.
				</p>
				<div className="mt-3 flex flex-wrap gap-1">
					<Link href="/beta/library/vault" className={`${quietButton} -ml-3`}>
						Open the Knowledge Vault
					</Link>
					<Link href="/notes" className={quietButton}>
						Your notes
					</Link>
				</div>
			</section>
			{room.isOwner && <RoomSettings room={room} act={act} busy={busy} onError={onError} purpose="group" />}
		</div>
	);
}

/** The plan in weeks: each week's readings, this one marked. */
function PlanWeeks({ group }: { group: GroupView }) {
	const plan = group.planWeeks;
	if (!plan) return null;
	const week = plan.weeks[plan.current - 1];
	return (
		<div className="mt-3">
			{week && (
				<p className="text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					<span className="font-bold">
						Week {week.week} of {plan.weeks.length}
					</span>{" "}
					· {week.readings}
				</p>
			)}
			<details className="mt-1">
				<summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-amber-800 dark:text-[#e5b664]">Every week of the plan</summary>
				<ol className="mt-1 max-h-72 space-y-1.5 overflow-y-auto pr-1">
					{plan.weeks.map((entry) => (
						<li key={entry.week} aria-current={entry.week === plan.current ? "true" : undefined} className={`rounded-xl px-3 py-1.5 text-sm leading-6 ${entry.week === plan.current ? "bg-amber-500/[.12] font-bold" : ""}`}>
							Week {entry.week} · {entry.readings}
						</li>
					))}
				</ol>
			</details>
		</div>
	);
}

function Members(props: Props) {
	const { group, onInvite } = props;
	const room = group.room;
	return (
		<section aria-labelledby="group-members" className={`${card} p-5`}>
			<div className="flex items-center justify-between gap-2">
				<h2 id="group-members" className={eyebrow}>
					Members · {room.members.length}
				</h2>
				{room.isOwner && !room.archived && (
					<button type="button" onClick={onInvite} className={`${quietButton} -mr-3`}>
						<UserPlus size={16} aria-hidden /> Invite
					</button>
				)}
			</div>
			<ul className="mt-1 divide-y divide-black/[.06] dark:divide-white/[.06]">
				{room.members.map((member) => (
					<MemberRow key={member.id} member={member} {...props} />
				))}
			</ul>
			{room.isOwner && room.members.length > 1 && (
				<p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">Leaders set each week&rsquo;s passage, prepare the questions, run the sessions and can remove members.</p>
			)}
		</section>
	);
}

function MemberRow({ member, group, act, busy, onLeave, onError }: { member: MemberView } & Props) {
	const room = group.room;
	const [confirming, setConfirming] = useState(false);
	const path = `/api/beta/groups/${room.id}/members/${member.id}`;
	const remove = async () => {
		if (member.action === "leave") return onLeave();
		const result = await act(`remove-${member.id}`, path, { method: "DELETE" });
		if (!result.ok) onError(result.error);
	};
	const setRole = async (role: "leader" | "member") => {
		const result = await act(`role-${member.id}`, path, { method: "PATCH", body: { role } });
		if (!result.ok) onError(result.error);
	};
	const canPromote = room.isOwner && !room.archived && member.role !== "owner";

	return (
		<li className="py-2.5">
			<div className="flex items-center gap-3">
				<Avatar name={member.displayName} size="sm" />
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate text-sm font-bold">
							{member.displayName}
							{member.isYou && <span className="font-normal text-neutral-600 dark:text-[#bbb3a7]"> (you)</span>}
						</span>
						<RoleBadge role={member.role} />
					</span>
					<span className="block text-xs text-neutral-600 dark:text-[#bbb3a7]">
						Joined <LocalDate iso={member.joinedAt} />
					</span>
				</span>
				{member.action && !confirming && (
					<button type="button" onClick={() => setConfirming(true)} className={quietButton}>
						{member.action === "leave" ? "Leave" : "Remove"}
					</button>
				)}
			</div>
			{canPromote && !confirming && (
				<div className="ml-11 mt-0.5">
					<button type="button" onClick={() => void setRole(member.role === "leader" ? "member" : "leader")} disabled={busy !== null} className={`${quietButton} -ml-3`}>
						{busy === `role-${member.id}` ? "Saving…" : member.role === "leader" ? "Make a member again" : "Make a leader"}
					</button>
				</div>
			)}
			{confirming && (
				<div className="mt-2 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 dark:bg-white/[.04]">
					<p>
						{member.action === "leave"
							? "Leave this group? Your answers, questions, session notes and prayer requests in it are removed from the group, and so are the replies under them. The copies in your own study, your notes and your reading plan stay yours."
							: `Remove ${member.displayName}? What they wrote in the group, and the replies under it, is removed with them.${room.inviteToken ? " The invite link is replaced so they cannot rejoin with it; share the new one with anyone still to join." : ""}`}
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button type="button" onClick={() => void remove()} disabled={busy !== null} className={dangerButton}>
							{busy === `remove-${member.id}` ? (member.action === "leave" ? "Leaving…" : "Removing…") : member.action === "leave" ? "Leave the group" : "Remove"}
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
