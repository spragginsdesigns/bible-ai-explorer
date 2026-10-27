"use client";

import {
	BookMarked,
	BookOpenCheck,
	Brain,
	Church,
	FolderOpen,
	Highlighter,
	MessagesSquare,
	NotebookPen,
	type LucideIcon,
} from "lucide-react";
import { DESTINATION_TILE } from "../visuals";
import type { IndexStatus } from "@/lib/beta/vault/meaning";
import type { VaultPassage } from "@/lib/beta/vault/passages";
import type { VaultEntry, VaultKind } from "@/lib/beta/vault/vault-rules";

/** Shapes the Vault's routes answer with (src/app/api/beta/vault/**). Kind tiles wear the Library's tint. */
export interface SearchResponse {
	entries: VaultEntry[];
	nextBefore: string | null;
	passage: VaultPassage | null;
	queryWasPassage: boolean;
	mode: "library" | "search" | "filter";
	index: IndexStatus | null;
}

export const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const eyebrow = "text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]";
export const muted = "text-neutral-600 dark:text-[#bbb3a7]";
export const chip =
	"inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors focus-visible:outline-amber-600";
export const chipOff = "border-black/10 bg-white/50 text-neutral-800 hover:border-amber-700/30 dark:border-white/10 dark:bg-white/[.03] dark:text-[#e6dfd1] dark:hover:border-amber-300/30";
export const chipOn = "border-transparent bg-[#24281f] text-white dark:bg-[#e5b664] dark:text-[#1c2118]";
const smallChipBase =
	"inline-flex items-center rounded-full border border-black/10 bg-white/60 px-3 text-[13px] font-semibold text-neutral-800 hover:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:text-[#e6dfd1] dark:hover:border-amber-300/40";
export const smallChip = `${smallChipBase} min-h-8`;
/** A small chip that is a button: a full 44px target on touch layouts, compact where there is a pointer. Never both heights in one class list: Tailwind's order, not the string's, would pick. */
export const tapChip = `${smallChipBase} min-h-11 lg:min-h-8`;

export const KIND_ICON: Record<VaultKind, LucideIcon> = {
	note: NotebookPen,
	highlight: Highlighter,
	chat: MessagesSquare,
	reading: BookOpenCheck,
	verse: BookMarked,
	memory: Brain,
	sermon: Church,
	study: FolderOpen,
};

export function KindTile({ kind, size = "sm" }: { kind: VaultKind; size?: "sm" | "md" }) {
	const Icon = KIND_ICON[kind];
	return (
		<span className={`flex shrink-0 items-center justify-center ${size === "md" ? "h-11 w-11 rounded-[14px]" : "h-9 w-9 rounded-[12px]"} ${DESTINATION_TILE.library}`} aria-hidden>
			<Icon size={size === "md" ? 22 : 19} strokeWidth={1.7} />
		</span>
	);
}

/** "May 12" this year, "May 12, 2025" before it. Local calendar, like every date a person reads. */
export function shortDate(iso: string, now = new Date()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

export function monthHeading(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** A JSON read of one of the Vault's routes; the route's own message on failure. */
export async function vaultFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { cache: "no-store", ...init });
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !body) throw new Error(body?.error ?? "Something went wrong. Please try again.");
	return body;
}

/** Days ago as "YYYY-MM-DD" in UTC, the form the filters carry. */
export function daysAgo(days: number, now = new Date()): string {
	return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
