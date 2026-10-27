"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Archive, ArrowLeft, UserPlus } from "lucide-react";
import type { RoomView } from "@/lib/beta/rooms/rooms";
import type { RoomPostKind } from "@/lib/beta/rooms/rooms-rules";
import { roomFetch, type RoomResult } from "./room-client";
import { Avatar, ErrorNote, card, secondaryButton } from "./room-ui";
import RoomFeed from "./RoomFeed";
import RoomGroupPanel from "./RoomGroupPanel";
import { InviteSheet, ReplacePlanSheet, ShareNoteSheet } from "./RoomSheets";

type Tab = "passage" | "question" | "note" | "group";
const TABS: { id: Tab; label: string }[] = [
	{ id: "passage", label: "Passages" },
	{ id: "question", label: "Questions" },
	{ id: "note", label: "Notes" },
	{ id: "group", label: "Group" },
];
/** How often an open, visible room checks for what the others added. */
const REFRESH_MS = 20_000;
/** Tailwind's lg: from here the Group column sits beside the feed and has no tab. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** What a child asks the room to do: one request, and the room it returns. */
export type RoomAct = (key: string, path: string, init?: { method?: string; body?: unknown }) => Promise<RoomResult<{ room: RoomView }>>;

export default function RoomScreen({ initialRoom }: { initialRoom: RoomView }) {
	const { userId } = useAuth();
	// A different account must never see the previous one's room, even briefly.
	return <RoomScreenContent key={userId ?? "guest"} initialRoom={initialRoom} />;
}

function RoomScreenContent({ initialRoom }: { initialRoom: RoomView }) {
	const router = useRouter();
	const [room, setRoom] = useState(initialRoom);
	const [tab, setTab] = useState<Tab>("question");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [gone, setGone] = useState(false);
	const [sheet, setSheet] = useState<null | "invite" | "share-note" | { replace: { id: string; title: string } }>(null);
	const busyRef = useRef(false);
	// Bumped by every change, so a refresh that left before it never lands after it.
	const changeSeq = useRef(0);
	const base = `/api/beta/rooms/${room.id}`;

	const act: RoomAct = useCallback(
		async (key, path, init) => {
			changeSeq.current += 1;
			busyRef.current = true;
			setBusy(key);
			setError(null);
			let result = await roomFetch(path, init);
			if (result.ok && result.data.room) setRoom(result.data.room);
			else if (!result.ok && result.status === 404) {
				// A post or member someone else just removed is a 404 too; only the
				// room itself answering 404 means you are no longer in it.
				const check = await roomFetch(base);
				if (check.ok) {
					setRoom(check.data.room);
					result = { ...result, error: "That is no longer in the room." };
				} else if (check.status === 404) setGone(true);
			}
			busyRef.current = false;
			setBusy(null);
			return result;
		},
		[base],
	);

	// The Group tab exists only on a phone; a window widened past it shows Questions.
	useEffect(() => {
		const query = window.matchMedia(DESKTOP_QUERY);
		const sync = () => {
			if (query.matches) setTab((current) => (current === "group" ? "question" : current));
		};
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);

	// Others post while you read: refresh while the tab is visible, and on return.
	useEffect(() => {
		if (gone) return;
		let stopped = false;
		const refresh = async () => {
			if (stopped || busyRef.current || document.visibilityState !== "visible") return;
			const seq = changeSeq.current;
			const result = await roomFetch(base);
			if (stopped || busyRef.current || seq !== changeSeq.current) return;
			if (result.ok) setRoom(result.data.room);
			else if (result.status === 404) setGone(true);
		};
		const timer = window.setInterval(refresh, REFRESH_MS);
		const onVisible = () => void refresh();
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			stopped = true;
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, [base, gone]);

	const followPlan = async (replacePlanId?: string) => {
		const result = await act("follow", `${base}/plan`, { method: "POST", body: replacePlanId ? { replacePlanId } : {} });
		if (result.ok) setSheet(null);
		else {
			const replace = result.body.replace as { id: string; title: string } | undefined;
			if (result.status === 409 && replace) setSheet({ replace });
			else {
				setSheet(null);
				setError(result.error);
			}
		}
	};

	const leave = async () => {
		if (busyRef.current) return;
		changeSeq.current += 1;
		busyRef.current = true;
		setBusy(`remove-${room.you.memberId}`);
		setError(null);
		const result = await roomFetch<{ left?: boolean }>(`${base}/members/${room.you.memberId}`, { method: "DELETE" });
		// Stay busy while the page changes, so nothing else is sent from a room you have left.
		if (result.ok) return router.push("/beta/study/rooms");
		busyRef.current = false;
		setBusy(null);
		setError(result.error);
	};

	// On a phone the members row opens Group; on a desktop Group is already beside the feed.
	const showGroup = () => {
		if (window.matchMedia(DESKTOP_QUERY).matches) document.getElementById("room-members")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		else setTab("group");
	};

	// Arrow keys move between the tabs a person can see (the Group tab is hidden on desktop).
	const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((el) => el.offsetParent !== null);
		const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		event.preventDefault();
		const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
		next.focus();
		next.click();
	};

	if (gone) {
		return (
			<main className="mx-auto w-full max-w-xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-10 lg:px-8">
				<section className={`${card} p-6`}>
					<h1 className="font-[family-name:var(--font-cormorant)] text-[30px] font-semibold leading-tight">You are no longer in this room</h1>
					<p className="mt-2 leading-7 text-neutral-700 dark:text-[#d9d1c3]">Its owner may have removed you. Your own notes and reading plan are untouched.</p>
					<Link href="/beta/study/rooms" className={`${secondaryButton} mt-5`}>
						Go to your rooms
					</Link>
				</section>
			</main>
		);
	}

	const shown = room.members.slice(0, 5);
	const groupPanel = (
		<RoomGroupPanel room={room} act={act} busy={busy} onInvite={() => setSheet("invite")} onShareNote={() => setSheet("share-note")} onFollow={() => void followPlan()} onLeave={() => void leave()} onError={setError} />
	);
	const feed = (kind: Exclude<RoomPostKind, "reply">) => (
		<RoomFeed room={room} kind={kind} act={act} busy={busy} onShareNote={() => setSheet("share-note")} onGoToGroup={() => setTab("group")} onInvite={() => setSheet("invite")} />
	);

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-8">
			<Link href="/beta/study/rooms" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study Rooms
			</Link>

			<header className="mt-2">
				<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.1rem,8vw,3rem)] font-semibold leading-[1.04] [overflow-wrap:anywhere]">{room.name}</h1>
				{room.description && <p className="mt-1.5 max-w-2xl text-[17px] leading-7 text-neutral-700 dark:text-[#d9d1c3]">{room.description}</p>}
				<div className="mt-4 flex items-center justify-between gap-3 border-t border-black/[.08] pt-4 dark:border-white/[.08]">
					<button type="button" onClick={showGroup} className="flex min-h-11 min-w-0 items-center gap-3 rounded-full text-left" aria-label={`${room.members.length} members. Show the group.`}>
						<span className="flex -space-x-2">
							{shown.map((member) => (
								<Avatar key={member.id} name={member.displayName} />
							))}
						</span>
						<span className="text-sm font-bold text-neutral-700 dark:text-[#d9d1c3]">{room.members.length === 1 ? "Just you" : `${room.members.length} members`}</span>
					</button>
					{room.isOwner && !room.archived && (
						<button type="button" onClick={() => setSheet("invite")} className={secondaryButton}>
							<UserPlus size={17} aria-hidden /> Invite
						</button>
					)}
				</div>
			</header>

			{room.archived && (
				<p className="mt-4 flex items-center gap-2.5 rounded-2xl border border-black/10 bg-black/[.035] px-4 py-3 text-sm leading-6 dark:border-white/10 dark:bg-white/[.04]">
					<Archive size={17} className="shrink-0" aria-hidden />
					{room.isOwner ? "This room is archived. You can read everything in it, and restore it from Group." : "This room is archived. You can read everything in it, but nothing new can be added."}
				</p>
			)}
			{error && (
				<div className="mt-4">
					<ErrorNote message={error} onDismiss={() => setError(null)} />
				</div>
			)}

			<div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
				<div className="min-w-0">
					<div role="tablist" aria-label="In this room" onKeyDown={onTabKey} className="grid grid-cols-4 gap-1 rounded-full border border-black/[.08] bg-black/[.035] p-1 lg:grid-cols-3 dark:border-white/[.08] dark:bg-white/[.04]">
						{TABS.map(({ id, label }) => {
							const selected = tab === id;
							return (
								<button
									key={id}
									type="button"
									role="tab"
									id={`room-tab-${id}`}
									aria-selected={selected}
									tabIndex={selected ? 0 : -1}
									aria-controls={`room-panel-${id}`}
									onClick={() => setTab(id)}
									className={`min-h-11 rounded-full px-2 text-sm font-bold transition-colors ${id === "group" ? "lg:hidden" : ""} ${
										selected ? "bg-[#fbf8f1] text-[#24281f] shadow-[0_1px_0_rgba(0,0,0,.06)] dark:bg-white/[.1] dark:text-[#f1eadc]" : "text-neutral-600 hover:text-neutral-900 dark:text-[#bbb3a7] dark:hover:text-neutral-100"
									}`}
								>
									{label}
								</button>
							);
						})}
					</div>

					<div className={tab === "group" ? "hidden" : "mt-5"}>
						{(["passage", "question", "note"] as const).map((kind) => (
							<div key={kind} role="tabpanel" id={`room-panel-${kind}`} aria-labelledby={`room-tab-${kind}`} hidden={tab !== kind}>
								{tab === kind && feed(kind)}
							</div>
						))}
					</div>
				</div>

				{/* One Group panel: the Group tab's content on a phone, a column beside the feed on a desktop. */}
				<aside id="room-panel-group" aria-label="The group" className={`${tab === "group" ? "mt-5" : "hidden"} lg:mt-0 lg:block`}>
					{groupPanel}
				</aside>
			</div>

			{sheet === "invite" && room.isOwner && <InviteSheet room={room} act={act} busy={busy} onClose={() => setSheet(null)} />}
			{sheet === "share-note" && <ShareNoteSheet room={room} act={act} onClose={() => setSheet(null)} onShared={() => { setSheet(null); setTab("note"); }} />}
			{sheet && typeof sheet === "object" && (
				<ReplacePlanSheet current={sheet.replace} planTitle={room.plan?.title ?? "the room's plan"} busy={busy === "follow"} onConfirm={() => void followPlan(sheet.replace.id)} onClose={() => setSheet(null)} />
			)}
		</main>
	);
}
