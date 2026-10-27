"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { initialsOf, type RoomPurpose } from "@/lib/beta/rooms/rooms-rules";

/** What each purpose calls a room in its copy ("Invite to the group"), and the product it belongs to. */
export const ROOM_COPY: Readonly<Record<RoomPurpose, { noun: string; product: string; one: string }>> = {
	study: { noun: "room", product: "Study Rooms", one: "a Study Room" },
	group: { noun: "group", product: "SureWord Groups", one: "a SureWord Group" },
	family: { noun: "family", product: "SureWord Family", one: "a family on SureWord" },
	church: { noun: "church", product: "SureWord Churches", one: "a church on SureWord" },
};

/** SureWord Beta's surfaces (docs/beta/README.md, Look and feel). */
export const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const field =
	"w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-2.5 text-base text-[#24281f] outline-none placeholder:text-neutral-500 focus:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:text-[#f1eadc] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/40";
export const primaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#e5b664] px-5 text-sm font-bold text-[#1c2118] transition-opacity hover:opacity-90 disabled:opacity-40";
export const secondaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/15 px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:text-neutral-100 dark:hover:bg-white/[.05]";
export const quietButton =
	"inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-neutral-600 transition-colors hover:bg-black/[.04] hover:text-neutral-900 disabled:opacity-40 dark:text-[#bbb3a7] dark:hover:bg-white/[.05] dark:hover:text-neutral-100";
export const dangerButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-red-700/30 px-4 text-sm font-bold text-red-800 transition-colors hover:bg-red-500/10 disabled:opacity-40 dark:border-red-300/30 dark:text-red-300";

/** A member's initials in a parchment disc; never a photo, never their account. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
	const box = size === "sm" ? "h-8 w-8 text-[13px]" : "h-10 w-10 text-[15px]";
	return (
		<span
			aria-hidden
			className={`flex shrink-0 items-center justify-center rounded-full border border-amber-900/15 bg-[#efe6d3] font-[family-name:var(--font-cormorant)] font-bold text-[#3b3a2c] dark:border-amber-200/15 dark:bg-white/[.06] dark:text-[#e9dfcb] ${box}`}
		>
			{initialsOf(name)}
		</span>
	);
}

/** "just now", "5m ago", "3h ago", "yesterday", "4 days ago", then a date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const minutes = Math.floor((now - then) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The reader's clock, read only after hydration (like BetaHome's greeting):
 * the server renders in UTC at another moment, so any time or date drawn from
 * it would not match the browser's and React would warn. Ticks each minute.
 */
export function useNow(): number | null {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	return now;
}

/** "3h ago" in the reader's clock; empty until the page has hydrated. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
	const now = useNow();
	return (
		<time dateTime={iso} className={className}>
			{now === null ? "" : timeAgo(iso, now)}
		</time>
	);
}

/** "Oct 26" in the reader's own time zone; empty until the page has hydrated. */
export function LocalDate({ iso }: { iso: string }) {
	const now = useNow();
	return <time dateTime={iso}>{now === null ? "" : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>;
}

export function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
	return (
		<div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-red-700/25 bg-red-500/[.07] px-4 py-3 text-sm text-red-900 dark:border-red-300/25 dark:text-red-200">
			<span className="pt-0.5">{message}</span>
			{onDismiss && (
				<button type="button" onClick={onDismiss} aria-label="Dismiss" className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-red-500/10">
					<X size={16} aria-hidden />
				</button>
			)}
		</div>
	);
}

/**
 * A modal sheet: rises from the bottom on a phone, centered on a desktop.
 * Mounted only while open, with the app's shared focus lifecycle.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const titleId = useId();
	const closeRef = useRef<HTMLButtonElement>(null);
	const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose, initialFocusRef: closeRef });
	return (
		<div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
			<div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[26px] border border-black/[.09] bg-[#f6f2e9] text-[#24281f] outline-none sm:rounded-[26px] dark:border-white/[.09] dark:bg-[#151915] dark:text-[#f1eadc]"
			>
				<div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
					<h2 id={titleId} className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight">
						{title}
					</h2>
					<button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5">
						<X size={20} aria-hidden />
					</button>
				</div>
				<div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2">{children}</div>
			</div>
		</div>
	);
}
