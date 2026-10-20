"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ChevronRight, Sparkles } from "lucide-react";
import { aiConsentGate } from "@/lib/ai-consent-gate";
import type { CatchUp, WhatsNewTarget } from "@/lib/whats-new-rules";
import { Button } from "@/components/ui/button";

/** Where each catch-up target lives on the web (Android maps the same names to its own routes). */
const WEB_ROUTES: Record<WhatsNewTarget, string> = {
	today: "/today",
	bible: "/bible",
	chat: "/",
	connections: "/connections",
	study: "/study",
	sermons: "/sermons",
	cross: "/cross",
	learn: "/bible/learn",
	plan: "/bible/plan",
	history: "/bible/history",
	timeline: "/bible/timeline",
};

/** Public pages, and the release notes themselves, never carry the sheet. */
const QUIET_PATHS = /^\/(whats-new|privacy|terms|support|sign-in|sign-up|share|shared|v)(\/|$)/;

/**
 * "Since you were last here": once per release, after an update brought
 * something new, a sheet of up to three cards. It waits for the AI consent
 * sheet to be answered, so the two never stack, and any way of closing it
 * (a card, See all, Got it, Escape) records the releases as seen on the
 * account, so it does not return on another device either.
 */
export default function WhatsNewPresenter() {
	const { userId, isLoaded } = useAuth();
	const pathname = usePathname();
	const consent = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot, aiConsentGate.getSnapshot);
	const consentSettled = (consent.record !== null || consent.declined) && !consent.prompt;
	const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
	const checkedFor = useRef<string | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	const quiet = QUIET_PATHS.test(pathname ?? "/");

	// Marked checked only once a result lands, so a Strict Mode double run or a
	// quiet page visited mid-flight cannot cost the reader this release's sheet.
	const currentUser = useRef(userId);
	currentUser.current = userId;
	const inFlight = useRef(false);

	useEffect(() => {
		if (!isLoaded || !userId || !consentSettled || quiet || checkedFor.current === userId || inFlight.current) return;
		inFlight.current = true;
		const owner = userId;
		void fetch("/api/whats-new/catch-up", { cache: "no-store" })
			.then((response) => (response.ok ? (response.json() as Promise<CatchUp>) : null))
			.then((result) => {
				if (currentUser.current !== owner || !result) return;
				checkedFor.current = owner;
				if (result.cards.length > 0) setCatchUp(result);
			})
			.catch(() => {
				// Offline or signed out mid-flight: nothing to show, try next launch.
			})
			.finally(() => {
				inFlight.current = false;
			});
	}, [isLoaded, userId, consentSettled, quiet]);

	useEffect(() => {
		const el = dialog.current;
		if (!el) return;
		if (catchUp && !el.open) el.showModal();
		if (!catchUp && el.open) el.close();
	}, [catchUp]);

	function dismiss() {
		if (!catchUp) return;
		const seen = catchUp.seenUpTo;
		setCatchUp(null);
		void fetch("/api/whats-new/catch-up", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ versionCode: seen }),
		}).catch(() => {
			// Unrecorded dismissals show the sheet once more next launch; harmless.
		});
	}

	if (!catchUp) return null;
	const more = catchUp.newReleaseCount - catchUp.cards.length;

	return createPortal(
		<dialog
			ref={dialog}
			aria-labelledby="whats-new-catch-up-title"
			onCancel={(event) => {
				event.preventDefault();
				dismiss();
			}}
			// Some browsers close a modal dialog without a cancel event; it still counts as seen.
			onClose={dismiss}
			className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-amber-700/20 bg-background p-6 text-foreground shadow-xl backdrop:bg-black/70 dark:border-amber-300/20"
		>
			<div className="flex items-start justify-between gap-4">
				<h2 id="whats-new-catch-up-title" className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold leading-tight">
					Since you were last here
				</h2>
				<span className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-neutral-950">
					{catchUp.newReleaseCount} {catchUp.newReleaseCount === 1 ? "update" : "updates"}
				</span>
			</div>
			<ul className="mt-5 grid gap-3 sm:grid-cols-3">
				{catchUp.cards.map((card) => (
					<li key={card.versionCode} className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
						<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
							<Sparkles className="h-3.5 w-3.5" aria-hidden /> {card.version}
						</span>
						<h3 className="font-[family-name:var(--font-cormorant)] text-xl font-semibold leading-snug">{card.title}</h3>
						<p className="flex-1 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{card.summary}</p>
						<Button asChild size="sm" className="mt-1">
							<Link href={card.target ? WEB_ROUTES[card.target] : `/whats-new/${card.version}`} onClick={dismiss}>
								{card.target ? "Try it" : "Read more"}
							</Link>
						</Button>
					</li>
				))}
			</ul>
			<Link
				href="/whats-new"
				onClick={dismiss}
				className="mt-5 flex min-h-11 items-center justify-between rounded-xl px-1 text-sm font-semibold text-amber-700 hover:underline dark:text-amber-300"
			>
				{more > 0 ? `See all release notes (${more} more)` : "See all release notes"}
				<ChevronRight className="h-4 w-4" aria-hidden />
			</Link>
			<Button variant="outline" className="mt-2 w-full" onClick={dismiss}>
				Got it
			</Button>
		</dialog>,
		document.body
	);
}
