"use client";

import { useEffect, useState } from "react";

/**
 * Settings -> CARDS YOU SENT (docs/FEATURES.md, "Share cards" -> "Send a
 * word"): every personal card this account sent, with Copy link and Revoke.
 * Revoking makes the card's page and image answer 404 at once. Mirrors
 * mobile/src/features/shareCards/SentCardsSection.tsx and the Apple list.
 */

interface SentCard {
	id: string;
	url: string;
	kind: "word" | "verse" | "reflection";
	reference: string;
	recipient: string | null;
	createdAt: string;
	revokedAt: string | null;
}

const COPIED_MS = 2000;

export default function SentCardsSection() {
	const [cards, setCards] = useState<SentCard[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = async () => {
		setLoadError(false);
		try {
			const response = await fetch("/api/cards/personal", { credentials: "same-origin" });
			if (!response.ok) throw new Error();
			const body = (await response.json()) as { cards?: SentCard[] };
			setCards(Array.isArray(body.cards) ? body.cards : []);
		} catch {
			setLoadError(true);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	useEffect(() => {
		if (!copiedId) return;
		const timer = setTimeout(() => setCopiedId(null), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copiedId]);

	const copy = async (card: SentCard) => {
		setActionError(null);
		try {
			await navigator.clipboard.writeText(card.url);
			setCopiedId(card.id);
		} catch {
			setActionError("Couldn't copy that link.");
		}
	};

	/** Optimistic, like revoking a shared answer: back to active if it fails. */
	const revoke = async (card: SentCard) => {
		if (pendingId) return;
		setPendingId(card.id);
		setActionError(null);
		setCards((current) => current?.map((row) => (row.id === card.id ? { ...row, revokedAt: new Date().toISOString() } : row)) ?? current);
		try {
			const response = await fetch(`/api/cards/personal/${card.id}`, { method: "DELETE", credentials: "same-origin" });
			if (!response.ok) throw new Error();
		} catch {
			setCards((current) => current?.map((row) => (row.id === card.id ? { ...row, revokedAt: card.revokedAt } : row)) ?? current);
			setActionError("Couldn't revoke that card.");
		} finally {
			setPendingId(null);
		}
	};

	return (
		<section id="sent-cards" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">CARDS YOU SENT</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[0.8125rem] leading-5 text-neutral-500 dark:text-neutral-400">
					Words you sent to someone. Revoke one to take its link and picture back.
				</p>
				{cards === null ? (
					<p className="text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
						{loadError ? (
							<>
								Couldn&apos;t load your cards.{" "}
								<button type="button" onClick={() => void load()} className="font-semibold text-amber-700 dark:text-amber-400">
									Retry
								</button>
							</>
						) : (
							"Loading your cards…"
						)}
					</p>
				) : cards.length === 0 ? (
					<p className="text-[0.8125rem] text-neutral-500 dark:text-neutral-400">Cards you send appear here.</p>
				) : (
					<ul className="flex flex-col gap-2">
						{cards.map((card) => {
							const revoked = Boolean(card.revokedAt);
							return (
								<li key={card.id} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] px-3 py-2.5 flex flex-col gap-1.5">
									<span className="text-sm text-neutral-900 dark:text-neutral-100">
										{card.recipient ? `For ${card.recipient} · ${card.reference}` : card.reference}
									</span>
									<span className="text-xs text-neutral-500 dark:text-neutral-400">
										{revoked ? "Revoked" : copiedId === card.id ? "Link copied" : new Date(card.createdAt).toLocaleDateString()}
									</span>
									{!revoked ? (
										<span className="flex gap-3">
											<button type="button" onClick={() => void copy(card)} className="min-h-9 text-xs font-bold text-amber-700 dark:text-amber-400">
												Copy link
											</button>
											<button
												type="button"
												onClick={() => void revoke(card)}
												disabled={pendingId !== null}
												className="min-h-9 text-xs font-bold text-red-600 dark:text-red-400 disabled:opacity-40"
											>
												Revoke
											</button>
										</span>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
				{actionError ? (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{actionError}
					</p>
				) : null}
			</div>
		</section>
	);
}
