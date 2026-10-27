"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Study Projects' small shared pieces (docs/beta/projects.md), drawn from the
 * beta's own surfaces (BetaHome, BetaModulePlaceholder): parchment cards with
 * a hairline border, Cormorant headings, gold as the one accent.
 */

export const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const serifTitle = "font-[family-name:var(--font-cormorant)] font-semibold leading-tight";
export const muted = "text-neutral-600 dark:text-[#bbb3a7]";
export const primaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#24281f] px-5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]";
export const goldButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#e5b664] px-5 text-sm font-bold text-[#1c2118] transition-opacity hover:opacity-90 disabled:opacity-40";
export const secondaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/15 px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:text-neutral-100 dark:hover:bg-white/[.05]";
export const ghostButton =
	"inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-bold text-amber-800 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-[#e5b664] dark:hover:bg-amber-300/10";
export const iconButton =
	"inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-black/5 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/5";
export const field =
	"w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/40";
/**
 * A 36px chip still answers taps over 44px: the invisible band above and below
 * is part of the button. It is placed from inside the 1px border, hence 5px.
 */
export const touchBand = "relative before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']";
export const chip =
	`${touchBand} inline-flex min-h-9 items-center rounded-full border border-black/10 px-3 text-sm font-semibold text-neutral-800 transition-colors hover:border-amber-700/30 hover:bg-white/70 dark:border-white/10 dark:text-neutral-100 dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]`;

export function ErrorNote({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p role="alert" className="rounded-2xl border border-red-700/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-800 dark:border-red-300/20 dark:text-red-200">
			{message}
		</p>
	);
}

/** A pulse placeholder line. */
export function SkeletonLine({ width = "w-full" }: { width?: string }) {
	return <span className={`block h-3.5 ${width} animate-pulse rounded bg-black/[.07] dark:bg-white/[.07]`} />;
}

/**
 * A modal sheet on the native <dialog> (focus is held inside and Escape
 * closes, by the browser): a bottom sheet on a phone, a centred panel on a
 * desktop.
 */
export function Sheet({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			aria-labelledby="project-sheet-title"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onClick={(event) => {
				if (event.target === ref.current) onClose();
			}}
			className={`inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-[26px] border border-black/10 bg-[#f6f2e9] p-0 text-[#24281f] backdrop:bg-black/55 dark:border-white/10 dark:bg-[#141813] dark:text-[#f1eadc] sm:inset-0 sm:m-auto sm:rounded-[26px] ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
		>
			{open && (
				<div className="flex max-h-[88dvh] flex-col">
					<div className="flex items-center justify-between gap-3 border-b border-black/[.07] px-5 py-3 dark:border-white/[.07]">
						<h2 id="project-sheet-title" className={`${serifTitle} text-[24px]`}>{title}</h2>
						<button type="button" onClick={onClose} className={iconButton} aria-label="Close">
							<X size={20} aria-hidden />
						</button>
					</div>
					<div className="overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">{children}</div>
				</div>
			)}
		</dialog>
	);
}

/** "Oct 26" or "Oct 26, 2025" for another year. */
export function shortDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
