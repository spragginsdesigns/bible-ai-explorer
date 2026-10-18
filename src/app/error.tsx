"use client";

import Link from "next/link";

/**
 * Route-level error screen. Without it any render error showed Next's blank
 * default page with no way back; reset() re-renders the segment in place.
 */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<div className="min-h-screen flex items-center justify-center gradient-mesh px-4">
			<div className="text-center max-w-sm">
				<h1 className="text-2xl font-bold text-neutral-200 mb-2">Something went wrong</h1>
				<p className="text-neutral-500 mb-6">
					This page hit an unexpected error. Your conversations and notes are safe.
				</p>
				<div className="flex items-center justify-center gap-4">
					<button
						type="button"
						onClick={reset}
						className="rounded-md bg-amber-500 px-4 py-2 font-medium text-neutral-950 hover:bg-amber-400 transition-colors"
					>
						Try again
					</button>
					<Link href="/" className="text-amber-400 hover:text-amber-300 transition-colors underline">
						Return to SureWord
					</Link>
				</div>
			</div>
		</div>
	);
}
