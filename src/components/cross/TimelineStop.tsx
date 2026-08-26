"use client";

import React from "react";

/**
 * One stop on the guided timeline: an amber node on a vertical rail, with the
 * section content to its right. The rail connects the day into one walk.
 *
 * Its own module because the Listen card renders its own stop: a card that can
 * decide to show nothing at all (an unconfigured server) has to own the node
 * and label above it, or the page would leave an empty ♪ hanging on the rail.
 *
 * Mirrors mobile/src/features/cross/TimelineStop.tsx.
 */
export default function TimelineStop({
	glyph,
	label,
	last = false,
	children,
}: {
	glyph: string;
	label?: string;
	last?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<div className="flex w-7 flex-col items-center">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold text-amber-600 dark:text-amber-400 shadow-[0_0_8px_rgba(217,119,6,0.35)] dark:shadow-[0_0_8px_rgba(251,191,36,0.3)]">
					{glyph}
				</div>
				{!last && (
					<div className="my-1 w-0.5 flex-1 rounded-full bg-amber-500/25 dark:bg-amber-400/20" />
				)}
			</div>
			<div className={`flex flex-1 flex-col gap-2 ${last ? "" : "pb-7"}`}>
				{label && (
					<h2 className="pt-1.5 text-[11.5px] font-bold tracking-[0.1em] text-amber-700/70 dark:text-amber-500/60">
						{label}
					</h2>
				)}
				{children}
			</div>
		</div>
	);
}
