"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { aiConsentGate, consentFetch } from "@/lib/ai-consent-gate";
import {
	TALK_IT_OVER_PROMPT,
	deviceTimezone,
	readerHref,
	reflectionAge,
	type ReflectionResponse,
} from "./readingOverview";

type CardState =
	| { kind: "loading" }
	| { kind: "consent" }
	| { kind: "error" }
	| { kind: "hidden" }
	| (Extract<ReflectionResponse, { status: "ready" }> & { kind: "ready" });

/** Covers the one generation after new reading (the route's maxDuration). */
const REFLECTION_TIMEOUT_MS = 60_000;

const link =
	"text-support font-semibold text-amber-600 hover:underline dark:text-amber-400";

/**
 * "Your walk": the AI reflection at the top of the reading log
 * (GET /api/reading-log/reflection). Mirrors
 * mobile/src/features/reading/WalkCard.tsx. The route is an automatic AI
 * request, so without consent the card offers to write one instead of asking
 * on open; nothing personal is sent until the person clicks.
 */
export default function WalkCard({
	getToken,
	refreshKey,
}: {
	getToken: () => Promise<string | null>;
	refreshKey: number;
}) {
	const [state, setState] = useState<CardState>({ kind: "loading" });
	const request = useRef(0);
	const controller = useRef<AbortController | null>(null);
	const token = useRef(getToken);
	token.current = getToken;

	const load = useCallback(async (ask: boolean) => {
		const id = ++request.current;
		controller.current?.abort();
		const abort = new AbortController();
		controller.current = abort;
		setState((old) => (old.kind === "ready" && !ask ? old : { kind: "loading" }));
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			// Ask first, outside the timeout, so time spent reading the consent
			// sheet never counts against the request.
			if (ask && !(await aiConsentGate.ensure(true, abort.signal))) {
				if (id === request.current) setState({ kind: "consent" });
				return;
			}
			if (id !== request.current) return;
			timer = setTimeout(() => abort.abort(), REFLECTION_TIMEOUT_MS);
			const bearer = await token.current();
			if (id !== request.current) return;
			if (!bearer) throw new Error("Signed out");
			const tz = deviceTimezone();
			const res = await consentFetch(
				`/api/reading-log/reflection${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`,
				{
					headers: { Authorization: `Bearer ${bearer}` },
					credentials: "omit",
					signal: abort.signal,
				}
			);
			if (id !== request.current) return;
			if (res.status === 403) {
				setState({ kind: "consent" });
				return;
			}
			if (!res.ok) throw new Error("Reflection unavailable");
			const result = (await res.json()) as ReflectionResponse;
			if (id !== request.current) return;
			if (result.status === "ready") setState({ ...result, kind: "ready" });
			else if (result.status === "consent-required") setState({ kind: "consent" });
			else if (result.status === "empty") setState({ kind: "hidden" });
			else setState({ kind: "error" });
		} catch {
			if (id === request.current) setState({ kind: "error" });
		} finally {
			if (timer) clearTimeout(timer);
		}
	}, []);

	useEffect(() => {
		void load(false);
		const requests = request;
		const inFlight = controller;
		return () => {
			requests.current++;
			inFlight.current?.abort();
		};
	}, [load, refreshKey]);

	if (state.kind === "hidden") return null;

	return (
		<section
			aria-label="Your walk"
			className="flex flex-col gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 dark:border-amber-400/30 dark:bg-amber-400/10 lg:p-6"
		>
			<p className="text-metadata font-bold tracking-[0.12em] text-amber-600 dark:text-amber-400">
				YOUR WALK
			</p>
			{state.kind === "loading" ? (
				<p
					role="status"
					className="flex items-center gap-2 text-support text-neutral-500 dark:text-neutral-400"
				>
					<Loader2
						className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400"
						aria-hidden
					/>
					Reflecting on your reading…
				</p>
			) : state.kind === "consent" ? (
				<>
					<p className="text-body text-neutral-700 dark:text-neutral-300">
						SureWord can write a short reflection on what you have been reading,
						connected to your questions, notes and memories, with a verse to carry
						and where to read next.
					</p>
					<button
						type="button"
						className={`self-start ${link}`}
						onClick={() => void load(true)}
					>
						Write my reflection →
					</button>
				</>
			) : state.kind === "error" ? (
				<>
					<p role="status" className="text-support text-neutral-500 dark:text-neutral-400">
						Your reflection could not be written right now.
					</p>
					<button
						type="button"
						className={`self-start ${link}`}
						onClick={() => void load(false)}
					>
						Try again
					</button>
				</>
			) : (
				<>
					<h2 className="text-section-title font-bold text-neutral-900 dark:text-neutral-100">
						{state.reflection.title}
					</h2>
					<p className="text-body text-neutral-700 dark:text-neutral-300">
						{state.reflection.reflection}
					</p>
					{state.reflection.verse ? (
						<Link
							href={readerHref({
								book: state.reflection.verse.book,
								chapter: state.reflection.verse.chapter,
								verse: state.reflection.verse.verse,
								translation: "KJV",
							})}
							aria-label={`Open ${state.reflection.verse.bookName} ${state.reflection.verse.chapter}:${state.reflection.verse.verse}`}
							className="flex flex-col gap-1 rounded-r-md border-l-[3px] border-amber-500 py-1 pl-4 pr-2 transition-colors hover:bg-amber-500/10 dark:border-amber-400 dark:hover:bg-amber-400/10"
						>
							<span className="text-body italic text-neutral-900 dark:text-neutral-100">
								“{state.reflection.verse.text}”
							</span>
							<span className="text-metadata font-semibold text-amber-600 dark:text-amber-400">
								{state.reflection.verse.bookName} {state.reflection.verse.chapter}:
								{state.reflection.verse.verse}
							</span>
							{state.reflection.verse.note ? (
								<span className="text-support text-neutral-500 dark:text-neutral-400">
									{state.reflection.verse.note}
								</span>
							) : null}
						</Link>
					) : null}
					{state.reflection.next ? (
						<Link
							href={readerHref({
								book: state.reflection.next.book,
								chapter: state.reflection.next.chapter,
							})}
							className="flex flex-col gap-1 rounded-xl border border-black/[0.08] bg-white/60 px-4 py-3 transition-colors hover:bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
						>
							<span className="text-control font-semibold text-neutral-900 dark:text-neutral-100">
								Read next: {state.reflection.next.bookName}{" "}
								{state.reflection.next.chapter} →
							</span>
							<span className="text-support text-neutral-500 dark:text-neutral-400">
								{state.reflection.next.reason}
							</span>
						</Link>
					) : null}
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="text-metadata text-neutral-400 dark:text-neutral-500">
							{reflectionAge(state.generatedAt, new Date())}
						</span>
						<Link
							href={`/?prompt=${encodeURIComponent(TALK_IT_OVER_PROMPT)}`}
							className={link}
						>
							Talk it over →
						</Link>
					</div>
				</>
			)}
		</section>
	);
}
