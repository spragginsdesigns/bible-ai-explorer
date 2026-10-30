"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { consentFetch } from "@/lib/ai-consent-gate";
import { checkedSavedAnswer, savedAnswerQuery, type SavedAnswerReview } from "@/lib/chat/history-review";

interface Props {
	review: SavedAnswerReview;
	renderVerified: (row: unknown) => React.ReactNode;
}

/** Checking never repairs or rewrites the saved original, and never replays tools. */
export default function HistoryReviewCard({ review, renderVerified }: Props) {
	const { userId, sessionId } = useAuth();
	const valid = !!review.parentId && /^[a-f0-9]{64}$/.test(review.sourceDigest);
	const identity = `${userId ?? ""}:${sessionId ?? ""}`;
	const key = `${identity}:${review.surface}:${review.parentId}:${review.messageId}:${review.sourceDigest}`;
	const current = useRef(key);
	current.current = key;
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [checked, setChecked] = useState<{ key: string; row: unknown } | null>(null);
	const request = useRef<AbortController | null>(null);
	useEffect(() => {
		current.current = key;
		setChecked(null); setBusy(false); setStatus("");
		return () => {
			if (current.current === key) current.current = "";
			request.current?.abort(); request.current = null;
		};
	}, [key]);

	const readState = async (signal: AbortSignal) => {
		const response = await consentFetch(`/api/ai/history/state?${savedAnswerQuery(review)}`, { cache: "no-store", signal });
		if (!response.ok) throw new Error("This saved answer could not be loaded. Please try again.");
		return response.json() as Promise<{ state: string; sourceDigest: string; row?: { id?: string; role?: string } }>;
	};
	const recheck = async () => {
		if (!valid || request.current || !userId || !sessionId) return;
		const captured = key;
		const controller = new AbortController(); request.current = controller;
		setBusy(true); setStatus("Checking the saved answer. Its original stays unchanged.");
		try {
			let state = await readState(controller.signal);
			if (current.current !== captured || controller.signal.aborted) return;
			if (state.sourceDigest !== review.sourceDigest) throw new Error("This saved answer changed. Reopen the conversation before checking it.");
			if (state.state !== "verified" && state.state !== "notice") {
				if (!/^[a-f0-9]{64}$/.test(state.sourceDigest)) throw new Error("The saved answer changed. Please load it again.");
				const response = await consentFetch("/api/ai/history/recheck", {
					method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
					body: JSON.stringify({ surface: review.surface, parentId: review.parentId, messageId: review.messageId, expectedSourceDigest: state.sourceDigest }),
				});
				if (current.current !== captured || controller.signal.aborted) return;
				if (!response.ok && response.status !== 422 && response.status !== 429) throw new Error("The answer could not be checked right now. Its original is still available.");
				state = await readState(controller.signal);
			}
			if (current.current !== captured || controller.signal.aborted) return;
			if (state.sourceDigest !== review.sourceDigest) throw new Error("This saved answer changed. Reopen the conversation before checking it.");
			const safeRow = checkedSavedAnswer(state, review);
			if (safeRow) {
				setChecked({ key: captured, row: safeRow }); setStatus("");
			} else setStatus(state.state === "pending" ? "This answer is still being checked. Check its status again in a moment." : "This saved answer could not be verified. You can download its original or ask the question again.");
		} catch (error) {
			if (current.current === captured && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "The answer could not be checked.");
		} finally {
			if (request.current === controller) request.current = null;
			if (current.current === captured) setBusy(false);
		}
	};

	if (checked?.key === key) return <>{renderVerified(checked.row)}</>;
	return <div className="my-3 rounded-xl border border-amber-600/30 bg-amber-500/5 p-4 text-sm">
		<p>This saved answer needs checking before it can be shown.</p>
		<p className="mt-1 text-neutral-500">Your original is preserved. Checking it won’t repeat any saved action.</p>
		<div className="mt-2 flex flex-wrap gap-3">
			<button type="button" className="min-h-11 text-amber-600 disabled:opacity-50" disabled={!valid || busy || !userId || !sessionId} onClick={() => void recheck()}>{busy ? "Checking…" : "Check saved answer"}</button>
			{valid && <a className="inline-flex min-h-11 items-center text-amber-600" href={`/api/ai/history/original?${savedAnswerQuery(review)}`} download>Download original (unchecked)</a>}
		</div>
		{status && <p role="status" aria-live="polite" className="mt-2 text-neutral-500">{status}</p>}
	</div>;
}
