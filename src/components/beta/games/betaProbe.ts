"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { GameAward } from "@/lib/beta/games/games-rules";

/**
 * The founders-only probe the Chapter Games' surfaces outside the beta share
 * (the reader's chapter-end card and the quiz results, LC-17905): GET
 * /api/beta/access, the one beta route every account may ask, made at most
 * once per account per session, the same pattern as the atlas's verse links
 * and the settings menu's own check.
 */
const betaAccess = new Map<string, boolean>();
const asking = new Map<string, Promise<boolean>>();

function probeBeta(userId: string): Promise<boolean> {
	const known = betaAccess.get(userId);
	if (known !== undefined) return Promise.resolve(known);
	let pending = asking.get(userId);
	if (!pending) {
		pending = fetch("/api/beta/access", { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { beta?: unknown } | null) => {
				const beta = data?.beta === true;
				if (data) betaAccess.set(userId, beta);
				return beta;
			})
			.catch(() => false)
			.finally(() => asking.delete(userId));
		asking.set(userId, pending);
	}
	return pending;
}

/** Whether the signed-in account is a founder: null until known, and false while signed out. */
export function useBetaAccess(enabled: boolean): boolean | null {
	const { isLoaded, userId } = useAuth();
	const [allowed, setAllowed] = useState<{ userId: string; beta: boolean } | null>(null);
	useEffect(() => {
		if (!enabled || !userId) return;
		let live = true;
		probeBeta(userId).then((beta) => {
			if (live) setAllowed({ userId, beta });
		});
		return () => {
			live = false;
		};
	}, [enabled, userId]);
	if (!enabled) return false;
	if (!isLoaded) return null;
	if (!userId) return false;
	// Known from an earlier chapter this session: answer at once, so the card never pops in late.
	return allowed?.userId === userId ? allowed.beta : (betaAccess.get(userId) ?? null);
}

export interface GameProgress {
	award: GameAward | null;
	/** The founder has finished this chapter's quiz at least once. */
	quizTaken: boolean;
}

/** The founder's award and quiz status for a game (GET /api/beta/games/<game>/award), read once allowed. */
export function useGameProgress(slug: string | null, allowed: boolean | null): GameProgress | null {
	const [progress, setProgress] = useState<{ slug: string; value: GameProgress } | null>(null);
	useEffect(() => {
		if (!slug || allowed !== true) return;
		let live = true;
		fetch(`/api/beta/games/${slug}/award`, { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { award?: GameAward | null; quizTaken?: unknown } | null) => {
				if (live && data) setProgress({ slug, value: { award: data.award ?? null, quizTaken: data.quizTaken === true } });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [slug, allowed]);
	return progress?.slug === slug ? progress.value : null;
}
