"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { TOUR_STOPS } from "@/lib/onboarding-rules";
import type { ShowInAppCard } from "@/lib/guide-cards";
import { showSpotlight, startTour } from "@/lib/spotlight";

/**
 * A "Show me" card (showInApp, docs/onboarding/PLAN.md): SureWord's caption
 * and one button that takes the reader to the place and lights it up. Every
 * one stays usable, not just the newest, because "where was that again?" is
 * a fair question to scroll back for.
 */
export default function ShowMeCard({ card, conversationId }: { card: ShowInAppCard; conversationId?: string }) {
	const tour = card.target === "tour";
	const show = () => {
		// A whole tour ends back in the conversation it started from.
		if (tour) startTour(card.stops ?? TOUR_STOPS, conversationId ? `/?conversationId=${encodeURIComponent(conversationId)}` : undefined);
		else showSpotlight(card.target, card.caption);
	};
	return (
		<div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-600/25 bg-amber-500/[0.05] p-4 sm:flex-row sm:items-center dark:border-amber-300/20 dark:bg-amber-300/[0.04]">
			<p className="flex-1 text-base leading-relaxed text-neutral-800 dark:text-neutral-200">{card.caption}</p>
			<button
				type="button"
				onClick={show}
				className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e5b664] px-5 text-base font-bold text-[#1c2118] transition-colors hover:bg-[#f0c77f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600"
			>
				<Sparkles className="h-4 w-4" aria-hidden />
				{tour ? "Show me around" : "Show me"}
			</button>
		</div>
	);
}
