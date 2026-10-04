"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";

import { trackSignIn } from "@/lib/analytics/client";
import {
	clerkErrorCodeFrom,
	clerkSignInFailureFrom,
	signInMethodFromStrategy,
} from "@/lib/analytics/web-signals";
import { observeFetch } from "./fetchObserver";

/**
 * The sign-in funnel for the web page, mirroring Android's
 * mobile/app/(auth)/sign-in.tsx: `sign_in_started`, `sign_in_completed` and
 * `sign_in_failed`, carrying the method and on failure Clerk's error code.
 *
 * Web renders Clerk's prebuilt `<SignIn>`, which exposes no per-step
 * callbacks, so this watches the two things that component cannot hide:
 *
 * - **The sign-in resource**, through `clerk.addListener`. A new attempt id is
 *   a start; `status: "complete"`, or a session appearing while an attempt is
 *   open, is a completion; a verification error (how a Google round trip
 *   reports failure) is a failure.
 * - **Clerk's Frontend API responses**, through the shared fetch observer. A
 *   wrong password or code never changes the resource, it only comes back as
 *   a 4xx, so the error code is read from that response's body.
 *
 * Only Clerk's error CODE and the request's `strategy` are ever read. The
 * identifier, the password, the code and Clerk's message (which can quote what
 * was typed) never reach an event.
 *
 * The open attempt is kept in sessionStorage because the Google flow leaves
 * the page and comes back on /sign-in/sso-callback, and its completion has to
 * be attributed to the start that preceded the round trip.
 */

const STORAGE_KEY = "sureword.analytics.signInAttempt";
/** An attempt older than this is abandoned, not pending. */
const ATTEMPT_TTL_MS = 30 * 60 * 1000;

interface Attempt {
	id: string;
	method: string;
	startedAt: number;
	reported: string[];
}

function readAttempt(): Attempt | null {
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const attempt = parsed as Partial<Attempt>;
		if (typeof attempt.id !== "string" || typeof attempt.method !== "string" || typeof attempt.startedAt !== "number") {
			return null;
		}
		if (Date.now() - attempt.startedAt > ATTEMPT_TTL_MS) return null;
		return { id: attempt.id, method: attempt.method, startedAt: attempt.startedAt, reported: Array.isArray(attempt.reported) ? attempt.reported.filter((r): r is string => typeof r === "string") : [] };
	} catch {
		return null;
	}
}

function writeAttempt(attempt: Attempt | null): void {
	try {
		if (attempt) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
		else window.sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// Storage can be blocked; the funnel then only loses cross-redirect joins.
	}
}

export default function SignInAnalytics(): null {
	const clerk = useClerk();

	useEffect(() => {
		// Same switch as the provider: no key, no SDK, nothing to observe.
		if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
		let sawSignedOut = false;
		let firstEmission = true;
		// Clerk keeps an unfinished sign-in on the client across reloads, so
		// one may already exist when this page opens. It is somebody's earlier
		// attempt, not a new start, and is left out of the funnel.
		let preexistingId: string | null = null;

		const complete = (attempt: Attempt) => {
			trackSignIn("completed", { method: attempt.method });
			writeAttempt(null);
		};

		const unsubscribe = clerk.addListener(({ client, session }) => {
			const signIn = client?.signIn;
			let attempt = readAttempt();
			const strategy = signIn?.firstFactorVerification?.strategy ?? null;
			if (firstEmission) {
				firstEmission = false;
				if (signIn?.id && signIn.id !== attempt?.id) preexistingId = signIn.id;
			}

			if (signIn?.id && signIn.id !== attempt?.id && signIn.id !== preexistingId) {
				// Matches Android's start names: `google` for the OAuth button,
				// `email` for an identifier typed into the form.
				const method = strategy?.startsWith("oauth_") ? (signInMethodFromStrategy(strategy) ?? "email") : "email";
				attempt = { id: signIn.id, method, startedAt: Date.now(), reported: [] };
				trackSignIn("started", { method });
				writeAttempt(attempt);
			} else if (attempt && signIn?.id === attempt.id) {
				// The method a completion is filed under is the factor that
				// finished it: `password` or `email_code` after an `email` start.
				const method = signInMethodFromStrategy(strategy);
				if (method && method !== attempt.method) {
					attempt = { ...attempt, method };
					writeAttempt(attempt);
				}
				const code = signIn.firstFactorVerification?.error?.code;
				if (code && !attempt.reported.includes(code)) {
					trackSignIn("failed", { method: attempt.method, reason: code });
					attempt = { ...attempt, reported: [...attempt.reported, code] };
					writeAttempt(attempt);
				}
			}

			if (!session) {
				sawSignedOut = true;
			}
			if (!attempt) return;
			if (signIn?.id === attempt.id && signIn.status === "complete") {
				complete(attempt);
			} else if (session && (sawSignedOut || signIn?.id !== attempt.id)) {
				// A session arrived while an attempt was open: either here, or
				// on return from the Google round trip, where the resource has
				// already moved on by the time this page loads.
				complete(attempt);
			}
		});

		const stopObserving = observeFetch(({ url, body, response }) => {
			if (!response || response.ok) return;
			const failure = clerkSignInFailureFrom(url, body);
			if (!failure) return;
			// The body is read from a clone, so Clerk still gets the original.
			response
				.clone()
				.json()
				.then(
					(payload: unknown) => {
						trackSignIn("failed", { method: failure.method, reason: clerkErrorCodeFrom(payload), step: failure.step });
					},
					() => {
						trackSignIn("failed", { method: failure.method, reason: `http_${response.status}`, step: failure.step });
					}
				);
		});

		return () => {
			unsubscribe();
			stopObserving();
		};
	}, [clerk]);

	return null;
}
