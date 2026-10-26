"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { aiConsentGate } from "@/lib/ai-consent-gate";
import { markGuestClaimOpened } from "@/lib/guest-client";
import { openWelcomeConversation, startWalkWithMe } from "@/lib/walk-client";

/** Pages a welcome must never pull somebody away from. */
const QUIET_PATHS = /^\/(sign-in|sign-up|privacy|terms|support|share|shared|v)(\/|$)/;

/** Accounts this page load has already asked about. */
const asked = new Set<string>();

function sessionKey(userId: string): string {
	return `sureword.walk.autoStarted.${userId}`;
}

/**
 * Opens the "Walk with me" welcome for a brand-new account
 * (docs/onboarding/PLAN.md): after sign-in, once the AI consent sheet is
 * settled with a yes, ask POST /api/onboarding/start {mode:"auto"} once per
 * browser session. The server decides; only a brand-new account (a guest who
 * just signed up included) comes back `created`, and that lands straight in
 * the welcome from wherever sign-in left them.
 *
 * A welcome that already exists and is not finished (`created: false`) is
 * reopened only from an empty chat, so a member mid-way through it who opens
 * a verse link is not dragged back to Chat.
 *
 * Without consent there is no welcome: the conversation is AI from its
 * second message, and a declined account has said no to that.
 */
export default function WalkWithMeLauncher() {
	const { isLoaded, isSignedIn, userId } = useAuth();
	const consent = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot, aiConsentGate.getSnapshot);
	const router = useRouter();
	const pathname = usePathname();
	const settled = consent.record !== null && !consent.prompt;

	useEffect(() => {
		if (!isLoaded || !isSignedIn || !userId || !settled) return;
		if (QUIET_PATHS.test(pathname) || asked.has(userId)) return;
		try {
			if (window.sessionStorage.getItem(sessionKey(userId)) === "1") return;
			window.sessionStorage.setItem(sessionKey(userId), "1");
		} catch {
			// Private windows can refuse storage; the page-load guard still holds.
		}
		asked.add(userId);
		void startWalkWithMe("auto").then((result) => {
			if (result?.status !== "active" || !aiConsentGate.isCurrentAccount()) return;
			const url = new URL(window.location.href);
			const onEmptyChat = url.pathname === "/" && !url.searchParams.get("conversationId");
			if (!result.created && !onEmptyChat) return;
			// A guest's claimed conversation must not pull them back out of it.
			markGuestClaimOpened();
			openWelcomeConversation(router, result.conversationId);
		});
	}, [isLoaded, isSignedIn, userId, settled, pathname, router]);

	return null;
}
