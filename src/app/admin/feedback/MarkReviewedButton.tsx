"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Marks one queue item reviewed (or puts it back) through
 * POST /api/admin/feedback, then re-renders the server page. A JSON body
 * means a cross-site form cannot forge the request.
 */
export default function MarkReviewedButton({
	kind,
	id,
	reviewed,
}: {
	kind: "rating" | "message";
	id: string;
	reviewed: boolean;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	async function toggle() {
		setError(null);
		const response = await fetch("/api/admin/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind, id, reviewed: !reviewed }),
		}).catch(() => null);
		if (!response?.ok) {
			setError("Could not save. Try again.");
			return;
		}
		startTransition(() => router.refresh());
	}

	return (
		<span className="inline-flex items-center gap-2">
			<button
				type="button"
				onClick={toggle}
				disabled={pending}
				className={
					reviewed
						? "rounded-md border border-neutral-600 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
						: "rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
				}
			>
				{pending ? "Saving..." : reviewed ? "Mark unreviewed" : "Mark reviewed"}
			</button>
			{error ? <span className="text-sm text-red-400">{error}</span> : null}
		</span>
	);
}
