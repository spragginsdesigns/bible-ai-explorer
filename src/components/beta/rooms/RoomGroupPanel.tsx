"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, Lock, NotebookPen, UserPlus } from "lucide-react";
import type { RoomView } from "@/lib/beta/rooms/rooms";
import { ROOM_DESCRIPTION_MAX, ROOM_NAME_MAX, type MemberView } from "@/lib/beta/rooms/rooms-rules";
import type { RoomAct } from "./RoomScreen";
import { Avatar, LocalDate, card, dangerButton, eyebrow, field, primaryButton, quietButton, secondaryButton } from "./room-ui";

interface Props {
	room: RoomView;
	act: RoomAct;
	busy: string | null;
	onInvite: () => void;
	onShareNote: () => void;
	onFollow: () => void;
	onLeave: () => void;
	onError: (message: string) => void;
}

export default function RoomGroupPanel(props: Props) {
	const { room } = props;
	return (
		<div className="space-y-4">
			<ReadingTogether {...props} />
			<Members {...props} />
			<section aria-labelledby="room-private" className={`${card} p-5`}>
				<h2 id="room-private" className={`${eyebrow} flex items-center gap-2`}>
					<Lock size={14} aria-hidden /> Your private study
				</h2>
				<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					Only you see this. Your notes, prayers and conversations with SureWord never appear in the room unless you share one. Sharing a note puts a copy here; the note itself stays yours.
				</p>
				<div className="mt-3 flex flex-wrap gap-2">
					{!room.archived && (
						<button type="button" onClick={props.onShareNote} className={secondaryButton}>
							<NotebookPen size={17} aria-hidden /> Share one of your notes
						</button>
					)}
					<Link href="/notes" className={quietButton}>
						Open your notes
					</Link>
				</div>
			</section>
			{room.isOwner && <OwnerSettings {...props} />}
		</div>
	);
}

function ReadingTogether({ room, act, busy, onFollow, onError }: Props) {
	const [choosing, setChoosing] = useState(false);
	const plan = room.plan;
	const setPlan = async (planPresetKey: string | null) => {
		const result = await act(`plan-${planPresetKey ?? "none"}`, `/api/beta/rooms/${room.id}`, { method: "PATCH", body: { planPresetKey } });
		if (result.ok) setChoosing(false);
		else onError(result.error);
	};
	const unfollow = async () => {
		const result = await act("unfollow", `/api/beta/rooms/${room.id}/plan`, { method: "DELETE" });
		if (!result.ok) onError(result.error);
	};
	const followers = room.members.filter((member) => member.plan.following);

	return (
		<section aria-labelledby="room-plan" className={`${card} p-5`}>
			<h2 id="room-plan" className={eyebrow}>
				Reading together
			</h2>

			{plan && !choosing ? (
				<>
					<p className="mt-2 font-[family-name:var(--font-cormorant)] text-[25px] font-semibold leading-tight">{plan.title}</p>
					<p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">
						Day {plan.todayDay} of {plan.dayCount} for the room
					</p>
					<div className="mt-3 rounded-2xl bg-black/[.035] px-4 py-3 dark:bg-white/[.04]">
						<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Today</p>
						<p className="mt-0.5 font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-tight">{plan.today.readings}</p>
						{plan.today.focus && <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">{plan.today.focus}</p>}
						{plan.today.href && (
							<Link href={plan.today.href} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
								<BookOpen size={16} aria-hidden /> Read today&rsquo;s chapters
							</Link>
						)}
					</div>

					{room.you.following ? (
						<p className="mt-4 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
							You are following this plan. It is your reading plan now, and the chapters you read in the Bible fill it in.{" "}
							<Link href="/bible/plan" className="font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
								Your plan
							</Link>
						</p>
					) : (
						!room.archived && (
							<div className="mt-4">
								<button type="button" onClick={onFollow} disabled={busy !== null} className={primaryButton}>
									{busy === "follow" ? "Starting…" : "Follow this plan"}
								</button>
								<p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-[#bbb3a7]">It becomes your reading plan from the room&rsquo;s day 1. The room sees only which day you are on and how many days you have read.</p>
							</div>
						)
					)}

					<h3 className="mt-5 text-sm font-bold">Where everyone is</h3>
					<ul className="mt-2 space-y-2.5">
						{room.members.map((member) => (
							<li key={member.id} className="flex items-center gap-3">
								<Avatar name={member.displayName} size="sm" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-bold">{member.isYou ? "You" : member.displayName}</span>
									{member.plan.following && member.plan.dayCount ? (
										<>
											<span className="block text-xs text-neutral-600 dark:text-[#bbb3a7]">
												On day {member.plan.currentDay} · {member.plan.completedCount} of {member.plan.dayCount} read
											</span>
											<span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.08]" aria-hidden>
												<span className="block h-full rounded-full bg-[#e5b664]" style={{ width: `${Math.max(member.plan.percent ?? 0, 2)}%` }} />
											</span>
										</>
									) : (
										<span className="block text-xs text-neutral-600 dark:text-[#bbb3a7]">Not following</span>
									)}
								</span>
							</li>
						))}
					</ul>
					<p className="mt-3 text-xs text-neutral-600 dark:text-[#bbb3a7]">
						{followers.length === 1 ? "1 person is" : `${followers.length} people are`} following.
					</p>

					<div className="mt-3 flex flex-wrap gap-1">
						{room.you.following && (
							<button type="button" onClick={() => void unfollow()} disabled={busy !== null} className={quietButton}>
								Stop sharing my progress
							</button>
						)}
						{room.isOwner && !room.archived && (
							<button type="button" onClick={() => setChoosing(true)} className={quietButton}>
								Change the plan
							</button>
						)}
					</div>
				</>
			) : room.isOwner && !room.archived ? (
				<>
					<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						{plan ? "A new plan starts at day 1 for everyone, today. Members follow it again if they want it." : "Choose a plan to read together. Everyone who follows it reads the same day's chapters."}
					</p>
					<ul className="mt-3 space-y-2">
						{(room.presets ?? []).map((preset) => (
							<li key={preset.key}>
								<button
									type="button"
									onClick={() => void setPlan(preset.key)}
									disabled={busy !== null || preset.key === plan?.presetKey}
									className="w-full rounded-2xl border border-black/10 px-4 py-3 text-left transition-colors hover:border-amber-700/30 hover:bg-white/60 disabled:opacity-50 dark:border-white/10 dark:hover:border-amber-300/30 dark:hover:bg-white/[.04]"
								>
									<span className="block font-bold">{preset.title}</span>
									<span className="mt-0.5 block text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">{preset.description}</span>
								</button>
							</li>
						))}
					</ul>
					{plan && (
						<div className="mt-3 flex flex-wrap gap-1">
							<button type="button" onClick={() => setChoosing(false)} className={quietButton}>
								Keep {plan.title}
							</button>
							<button type="button" onClick={() => void setPlan(null)} disabled={busy !== null} className={quietButton}>
								Take the plan down
							</button>
						</div>
					)}
				</>
			) : (
				<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					No plan yet. {room.members.find((member) => member.role === "owner")?.displayName ?? "The owner"} can choose one for the room.
				</p>
			)}
		</section>
	);
}

function MemberRow({ member, room, act, busy, onLeave, onError }: { member: MemberView } & Props) {
	const [confirming, setConfirming] = useState(false);
	const remove = async () => {
		if (member.action === "leave") return onLeave();
		const result = await act(`remove-${member.id}`, `/api/beta/rooms/${room.id}/members/${member.id}`, { method: "DELETE" });
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
						{member.role === "owner" ? (
							"Owner"
						) : (
							<>
								Joined <LocalDate iso={member.joinedAt} />
							</>
						)}
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
							? "Leave this room? Everything you posted in it is removed, and so are the replies under your posts. Your own notes and reading plan stay yours."
							: `Remove ${member.displayName}? Everything they posted in the room, and the replies under it, is removed with them.${room.inviteToken ? " The invite link is replaced so they cannot rejoin with it; share the new one with anyone still to join." : ""}`}
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<button type="button" onClick={() => void remove()} disabled={busy !== null} className={dangerButton}>
							{busy === `remove-${member.id}` ? (member.action === "leave" ? "Leaving…" : "Removing…") : member.action === "leave" ? "Leave the room" : "Remove"}
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

function Members(props: Props) {
	const { room, onInvite } = props;
	return (
		<section aria-labelledby="room-members" className={`${card} p-5`}>
			<div className="flex items-center justify-between gap-2">
				<h2 id="room-members" className={eyebrow}>
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
		</section>
	);
}

function OwnerSettings({ room, act, busy, onError }: Props) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(room.name);
	const [description, setDescription] = useState(room.description ?? "");
	const [confirmArchive, setConfirmArchive] = useState(false);
	const save = async (event: FormEvent) => {
		event.preventDefault();
		const result = await act("rename", `/api/beta/rooms/${room.id}`, { method: "PATCH", body: { name, description } });
		if (result.ok) setEditing(false);
		else onError(result.error);
	};
	const archive = async (archived: boolean) => {
		const result = await act("archive", `/api/beta/rooms/${room.id}`, { method: "PATCH", body: { archived } });
		if (result.ok) setConfirmArchive(false);
		else onError(result.error);
	};

	return (
		<section aria-labelledby="room-settings" className={`${card} p-5`}>
			<h2 id="room-settings" className={eyebrow}>
				Room settings
			</h2>
			{room.archived ? (
				<>
					<p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">Restoring opens the room to new posts again. The invite link stays off until you make a new one.</p>
					<button type="button" onClick={() => void archive(false)} disabled={busy !== null} className={`${primaryButton} mt-3`}>
						{busy === "archive" ? "Restoring…" : "Restore the room"}
					</button>
				</>
			) : editing ? (
				<form onSubmit={save} className="mt-3 space-y-3">
					<label className="block">
						<span className="mb-1.5 block text-sm font-bold">Room name</span>
						<input value={name} onChange={(event) => setName(event.target.value)} maxLength={ROOM_NAME_MAX} required className={field} />
					</label>
					<label className="block">
						<span className="mb-1.5 block text-sm font-bold">What you are studying</span>
						<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={ROOM_DESCRIPTION_MAX} rows={2} className={`${field} resize-none`} />
					</label>
					<div className="flex flex-wrap gap-2">
						<button type="submit" disabled={busy !== null || !name.trim()} className={primaryButton}>
							{busy === "rename" ? "Saving…" : "Save"}
						</button>
						<button type="button" onClick={() => setEditing(false)} className={quietButton}>
							Cancel
						</button>
					</div>
				</form>
			) : (
				<>
					<div className="mt-2 flex flex-wrap gap-1">
						<button type="button" onClick={() => setEditing(true)} className={`${quietButton} -ml-3`}>
							Rename or describe
						</button>
						{!confirmArchive && (
							<button type="button" onClick={() => setConfirmArchive(true)} className={quietButton}>
								Archive the room
							</button>
						)}
					</div>
					{confirmArchive && (
						<div className="mt-2 rounded-2xl bg-black/[.035] px-4 py-3 text-sm leading-6 dark:bg-white/[.04]">
							<p>Archive this room? Everyone can still read it, but nothing new can be added and the invite link stops working. You can restore it later.</p>
							<div className="mt-2 flex flex-wrap gap-2">
								<button type="button" onClick={() => void archive(true)} disabled={busy !== null} className={dangerButton}>
									{busy === "archive" ? "Archiving…" : "Archive"}
								</button>
								<button type="button" onClick={() => setConfirmArchive(false)} className={quietButton}>
									Cancel
								</button>
							</div>
						</div>
					)}
				</>
			)}
		</section>
	);
}
