"use client";

import React from "react";

/** Which way the user steered today's replacement word. */
export type CrossDirection = "stay" | "fresh";

/**
 * The two quiet steers that sit beside "a different word for today": keep
 * today's theme and go further into it, or leave it for a different area of
 * life. No confirmation, no counters — one tap posts a `direction` and the
 * page's existing replacement flow takes over.
 *
 * "Stay with this" only renders when the loaded day actually carries a theme;
 * the route answers 409 without one, so a button that could only fail is not
 * shown. Mirrors mobile/src/features/cross/DirectionControls.tsx.
 */
export default function DirectionControls({
	canStay,
	disabled = false,
	onDirection,
}: {
	canStay: boolean;
	disabled?: boolean;
	onDirection: (direction: CrossDirection) => void;
}) {
	const className =
		"min-h-11 rounded-lg px-2 text-metadata font-semibold text-neutral-500 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-50 transition-colors";
	return (
		<div className="mt-1 flex flex-wrap items-center justify-center gap-x-5">
			{canStay && (
				<button
					type="button"
					onClick={() => onDirection("stay")}
					disabled={disabled}
					className={className}
				>
					Stay with this
				</button>
			)}
			<button
				type="button"
				onClick={() => onDirection("fresh")}
				disabled={disabled}
				className={className}
			>
				Take me somewhere fresh
			</button>
		</div>
	);
}
