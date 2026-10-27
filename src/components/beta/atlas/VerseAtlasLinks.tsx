"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { MapPinned } from "lucide-react";

/**
 * The reader's way into SureWord Beta's atlas (LC-17655, docs/beta/atlas.md):
 * in the verse sheet, for founders only, the places the selected verses name,
 * each opening the atlas on that place.
 *
 * Everyone else never sees it and never calls the atlas: the founders-only
 * probe (GET /api/beta/access, the one beta route every account may ask) is
 * made at most once per account per session, like the settings menu's own
 * check in AppOptions, and only after a verse is opened.
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

export default function VerseAtlasLinks({ order, chapter, start, end }: { order: number; chapter: number; start: number; end: number }) {
	const { userId } = useAuth();
	const [found, setFound] = useState<{ key: string; places: { id: string; name: string }[] } | null>(null);
	const key = `${userId}:${order}:${chapter}:${start}:${end}`;

	useEffect(() => {
		if (!userId) return;
		const controller = new AbortController();
		probeBeta(userId).then((beta) => {
			if (!beta || controller.signal.aborted) return;
			fetch(`/api/beta/atlas/verse?book=${order}&chapter=${chapter}&verse=${start}&end=${end}`, { cache: "no-store", signal: controller.signal })
				.then((response) => (response.ok ? response.json() : null))
				.then((data: { places?: { id: string; name: string }[] } | null) => {
					if (!controller.signal.aborted) setFound({ key, places: data?.places ?? [] });
				})
				.catch(() => {
					/* The row is optional; a failed fetch shows nothing. */
				});
		});
		return () => controller.abort();
	}, [userId, order, chapter, start, end, key]);

	const places = found?.key === key ? found.places : [];
	if (places.length === 0) return null;
	return (
		<nav aria-label="Places in the atlas" className="flex flex-wrap items-center gap-2 px-4 pb-3">
			<span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-neutral-400">
				<MapPinned size={14} aria-hidden /> In the atlas
			</span>
			{places.map((place) => (
				<Link
					key={place.id}
					href={`/beta/bible/atlas?place=${encodeURIComponent(place.id)}`}
					className="inline-flex min-h-11 items-center rounded-full border border-amber-700/30 bg-amber-500/10 px-3.5 text-sm font-semibold text-amber-900 hover:bg-amber-500/20 dark:border-amber-300/30 dark:text-amber-200"
				>
					{place.name} ›
				</Link>
			))}
		</nav>
	);
}
