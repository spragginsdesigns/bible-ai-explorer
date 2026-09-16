"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import type { ChatReceipt } from "@/lib/chat/receipts";
import { receiptHref } from "@/lib/chat/receipt-links";

interface ReceiptLineProps {
	/** Every receipt of the turn, in parser order. */
	receipts: readonly ChatReceipt[];
}

const FRAGMENT_CLASS =
	"inline-flex min-h-11 items-center text-sm text-amber-700 hover:underline dark:text-amber-400 sm:min-h-0";

/** The " · " every fragment of the line is joined by, Undo included. */
const FragmentSeparator: React.FC = () => (
	<span aria-hidden className="text-sm text-amber-700/50 dark:text-amber-400/50">
		·
	</span>
);

/**
 * Forget one memory. This calls the route directly rather than through
 * `deleteMemory` in src/lib/memories.ts because that helper flattens the
 * response into an Error message and loses the status, and a 404 has to be
 * told apart from a real failure here: an old conversation reopened after the
 * memory was already forgotten answers 404, and the honest fragment for that
 * is "Forgotten", not an error.
 */
async function forgetMemory(memoryId: string): Promise<void> {
	const res = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (res.ok || res.status === 404) return;
	const body = (await res.json().catch(() => null)) as { error?: string } | null;
	throw new Error(body?.error ?? `Request failed (${res.status})`);
}

/**
 * Receipts: one line for everything the assistant saves. The contract lives in
 * docs/FEATURES.md; the parser is src/lib/chat/receipts.ts and the routes are
 * src/lib/chat/receipt-links.ts.
 *
 * All receipts of a turn render as a single wrapping line of tappable
 * fragments joined by " · ", in the accent colour, under the answer. A receipt
 * carrying `undo` gets an Undo affordance right after its fragment; a
 * successful undo replaces the fragment with a plain "Forgotten" for the rest
 * of the session.
 */
const ReceiptLine: React.FC<ReceiptLineProps> = ({ receipts }) => {
	const [forgotten, setForgotten] = useState<readonly string[]>([]);
	const [pending, setPending] = useState<readonly string[]>([]);
	const [error, setError] = useState<string | null>(null);

	const forget = useCallback(async (receiptId: string, memoryId: string) => {
		// One shot per fragment: the button is gone once the id is pending or
		// forgotten, so a second DELETE can never be fired from the line.
		setPending((ids) => (ids.includes(receiptId) ? ids : [...ids, receiptId]));
		setError(null);
		try {
			await forgetMemory(memoryId);
			setForgotten((ids) => (ids.includes(receiptId) ? ids : [...ids, receiptId]));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not forget that memory.");
		} finally {
			setPending((ids) => ids.filter((id) => id !== receiptId));
		}
	}, []);

	if (receipts.length === 0) return null;

	return (
		<div className="mt-2">
			<div className="flex flex-wrap items-center gap-x-1.5">
				{receipts.map((receipt, index) => {
					const isForgotten = forgotten.includes(receipt.id);
					const isPending = pending.includes(receipt.id);
					const undo = receipt.undo;
					return (
						<React.Fragment key={receipt.id}>
							{index > 0 && <FragmentSeparator />}
							{isForgotten ? (
								<span className="inline-flex min-h-11 items-center text-sm text-neutral-500 dark:text-neutral-400 sm:min-h-0">
									Forgotten
								</span>
							) : (
								<Link href={receiptHref(receipt.target)} className={FRAGMENT_CLASS}>
									{receipt.label}
								</Link>
							)}
							{undo && !isForgotten && (
								<>
									{/* Undo is a fragment of the line like any other, so it is
									    separated the same way: "Remembered · Undo". */}
									<FragmentSeparator />
									<button
										type="button"
										disabled={isPending}
										onClick={() => void forget(receipt.id, undo.memoryId)}
										title={error ?? undefined}
										className="inline-flex min-h-11 items-center text-sm text-neutral-500 underline decoration-dotted transition-colors hover:text-amber-700 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-amber-400 sm:min-h-0"
									>
										{isPending ? "Forgetting…" : "Undo"}
									</button>
								</>
							)}
						</React.Fragment>
					);
				})}
			</div>
			{error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
		</div>
	);
};

export default ReceiptLine;
