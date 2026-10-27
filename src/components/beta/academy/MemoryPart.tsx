"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import type { MemoryVerseView } from "@/lib/beta/academy/academy-types";
import { addCards } from "../memory/memoryClient";
import { EYEBROW, QUIET_BUTTON, SERIF, TEXT_LINK } from "../paths/ui";

/**
 * A lesson's verses to memorize (LC-17660), each added to Scripture Memory
 * through its own route, so a card made here is the same Learn a verse card
 * with the same schedule as one made anywhere else in SureWord.
 */
export default function MemoryPart({ verses, locked }: { verses: MemoryVerseView[]; locked: boolean }) {
	const router = useRouter();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const add = async (ref: string) => {
		setBusy(ref);
		setError(null);
		try {
			await addCards(ref, "suggestion");
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "The verse could not be added. Please try again.");
		} finally {
			setBusy(null);
		}
	};
	const allIn = verses.every((verse) => verse.inDeck);
	return (
		<div className="mt-4 flex flex-col gap-3">
			{verses.map((verse) => (
				<figure key={verse.ref} className="rounded-2xl border border-black/[.08] px-4 py-3 dark:border-white/[.08]">
					<blockquote className={`${SERIF} text-[20px] leading-[1.45]`}>{verse.text}</blockquote>
					<figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2">
						<span className={EYEBROW}>{verse.ref} · KJV</span>
						{verse.inDeck ? (
							<span className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-emerald-800 dark:text-emerald-300">
								<Check size={16} aria-hidden /> In your memory cards
							</span>
						) : (
							<button type="button" onClick={() => void add(verse.ref)} disabled={locked || busy !== null} className={QUIET_BUTTON} aria-label={`Add ${verse.ref} to Scripture Memory`}>
								<Plus size={16} aria-hidden /> {busy === verse.ref ? "Adding..." : "Add to Scripture Memory"}
							</button>
						)}
					</figcaption>
				</figure>
			))}
			{error && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			{allIn && (
				<Link href="/beta/learn/memory" className={TEXT_LINK}>
					Practise them in Scripture Memory
				</Link>
			)}
		</div>
	);
}
