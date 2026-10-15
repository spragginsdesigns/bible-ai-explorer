"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { resolveReference } from "@/lib/bible/books";
import type { TranslationId } from "@/lib/bible/translations";

interface CrossReferenceItem {
	reference: string;
	text?: string;
}

interface CrossReferencesResponse {
	reference: string;
	translation: TranslationId;
	crossReferences: CrossReferenceItem[];
}

interface CrossReferencesSectionProps {
	reference: string;
	translation: TranslationId;
	onNavigate?: () => void;
	/**
	 * Renders the list open with no collapsible header row, for a caller that
	 * already gave cross-references a surface of their own (the reader's "See
	 * also" tab). Such a caller also needs to be told when there are none,
	 * rather than being left with a blank panel.
	 */
	alwaysExpanded?: boolean;
}

type LoadState =
	| { status: "loading"; items: CrossReferenceItem[] }
	| { status: "ready"; items: CrossReferenceItem[] }
	| { status: "error"; items: CrossReferenceItem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** NKJV provider text may contain inline emphasis markup. This section is plain text. */
function plainScriptureText(markup: string): string {
	if (!markup.includes("<") && !markup.includes("&")) return markup;
	return new DOMParser().parseFromString(markup, "text/html").body.textContent ?? markup;
}

/** Ranges open at their first verse, with the reader translation preserved. */
function chapterHref(reference: string, translation: TranslationId): string | null {
	const start = reference.split(/[-\u2013\u2014]/, 1)[0];
	const target = resolveReference(start);
	if (!target) return null;
	const query = new URLSearchParams({
		book: String(target.order),
		chapter: String(target.chapter),
		translation,
	});
	if (target.verse !== undefined) query.set("verse", String(target.verse));
	return `/bible/chapter?${query.toString()}`;
}

function parseResponse(value: unknown, translation: TranslationId): CrossReferencesResponse | null {
	if (!isRecord(value) || value.translation !== translation || typeof value.reference !== "string") {
		return null;
	}
	if (!Array.isArray(value.crossReferences)) return null;

	const crossReferences: CrossReferenceItem[] = [];
	for (const candidate of value.crossReferences) {
		if (!isRecord(candidate) || typeof candidate.reference !== "string") return null;
		if (candidate.text !== undefined && typeof candidate.text !== "string") return null;
		crossReferences.push({
			reference: candidate.reference,
			...(candidate.text ? { text: plainScriptureText(candidate.text) } : {}),
		});
	}
	return { reference: value.reference, translation, crossReferences: crossReferences.slice(0, 5) };
}

const crossRefsCache = new Map<string, CrossReferenceItem[]>();
const crossRefsPending = new Map<string, Promise<CrossReferenceItem[]>>();

function cacheKey(reference: string, translation: TranslationId): string {
	return `${translation}:${reference.trim()}`;
}

async function fetchCrossReferences(
	reference: string,
	translation: TranslationId,
	signal?: AbortSignal
): Promise<CrossReferenceItem[]> {
	const key = cacheKey(reference, translation);
	const cached = crossRefsCache.get(key);
	if (cached) return cached;

	if (!signal) {
		const inflight = crossRefsPending.get(key);
		if (inflight) return inflight;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });

	const task = (async () => {
		try {
			const query = new URLSearchParams({ reference, translation, limit: "5" });
			const response = await fetch(`/api/bible/crossrefs?${query.toString()}`, {
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`Cross-reference request failed: ${response.status}`);
			const parsed = parseResponse(await response.json(), translation);
			if (!parsed) throw new Error("Unexpected cross-reference response");
			crossRefsCache.set(key, parsed.crossReferences);
			return parsed.crossReferences;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	})();

	if (!signal) {
		crossRefsPending.set(
			key,
			task.finally(() => crossRefsPending.delete(key))
		);
	}
	return task;
}

/**
 * Warm the in-memory cross-reference cache as soon as a verse selection settles,
 * so switching to the "See also" tab renders immediately without a loading flash.
 */
export function prefetchCrossReferences(reference: string, translation: TranslationId): void {
	if (!reference.trim()) return;
	void fetchCrossReferences(reference, translation).catch(() => {});
}

/** A collapsed, translation-aware list of the five closest Scripture links. */
export default function CrossReferencesSection({
	reference,
	translation,
	onNavigate,
	alwaysExpanded = false,
}: CrossReferencesSectionProps) {
	const [expanded, setExpanded] = useState(false);
	const initialCached = crossRefsCache.get(cacheKey(reference, translation));
	const [state, setState] = useState<LoadState>(() =>
		initialCached ? { status: "ready", items: initialCached } : { status: "loading", items: [] }
	);
	const requestId = useRef(0);
	const controllerRef = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		const id = ++requestId.current;
		controllerRef.current?.abort();
		const cached = crossRefsCache.get(cacheKey(reference, translation));
		if (cached) {
			setState({ status: "ready", items: cached });
			return;
		}
		const controller = new AbortController();
		controllerRef.current = controller;
		setState({ status: "loading", items: [] });
		try {
			const items = await fetchCrossReferences(reference, translation, controller.signal);
			if (requestId.current === id) {
				setState({ status: "ready", items });
			}
		} catch {
			if (requestId.current === id) setState({ status: "error", items: [] });
		} finally {
			if (controllerRef.current === controller) controllerRef.current = null;
		}
	}, [reference, translation]);

	useEffect(() => {
		setExpanded(false);
		void load();
		return () => {
			requestId.current += 1;
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
	}, [load]);

	// A collapsed section with nothing behind it is noise, so it disappears.
	// An always-open one is the whole panel, so it says so instead.
	if (state.status === "ready" && state.items.length === 0 && !alwaysExpanded) return null;

	const open = alwaysExpanded || expanded;

	return (
		<div className="mb-2 overflow-hidden rounded-xl border border-black/[0.08] bg-black/[0.03] dark:border-white/[0.08] dark:bg-white/[0.03]">
			{!alwaysExpanded && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((current) => !current)}
					className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
				>
					<span className="flex-1 text-metadata font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
						See also
					</span>
					<span className="text-metadata text-neutral-400 dark:text-neutral-500">
						{state.status === "loading"
							? "Loading"
							: state.status === "error"
								? "Unavailable"
								: `${state.items.length} ${state.items.length === 1 ? "passage" : "passages"}`}
					</span>
					<span aria-hidden className="text-neutral-400 dark:text-neutral-500">
						{expanded ? "▴" : "▾"}
					</span>
				</button>
			)}

			{open && (
				<div
					className={`px-3 py-3 ${
						alwaysExpanded ? "" : "border-t border-black/[0.06] dark:border-white/[0.06]"
					}`}
				>
					{state.status === "ready" && state.items.length === 0 ? (
						<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
							No related passages for this verse.
						</p>
					) : state.status === "loading" ? (
						<p role="status" className="text-[13px] text-neutral-500 dark:text-neutral-400">
							Loading related passages…
						</p>
					) : state.status === "error" ? (
						<div className="flex items-center gap-3">
							<p className="flex-1 text-[13px] text-neutral-500 dark:text-neutral-400">
								Related passages could not be loaded.
							</p>
							<button
								type="button"
								onClick={() => void load()}
								className="text-[13px] font-semibold text-amber-600 dark:text-amber-400"
							>
								Try again
							</button>
						</div>
					) : (
						<ul className="flex flex-col gap-3">
							{state.items.map((item) => {
								const href = chapterHref(item.reference, translation);
								const referenceLabel = (
									<span className="text-[13.5px] font-bold text-amber-600 dark:text-amber-400">
										{item.reference}
									</span>
								);
								return (
									<li key={item.reference}>
										{href ? (
											<Link href={href} onClick={onNavigate}>
												{referenceLabel}
											</Link>
										) : (
											referenceLabel
										)}
										{item.text && (
											<p className="pt-1 font-[family-name:var(--font-cormorant)] text-[16px] leading-6 text-neutral-700 dark:text-neutral-300">
												{item.text}
											</p>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
