import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { aiConsentGate } from "@/lib/aiConsentGate";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { startOnboarding } from "./api";
import { hydrateOnboarding, rememberWelcomeConversation } from "./onboardingStore";

/**
 * Walk with me's front door. Once per launch, after sign-in and after the AI
 * consent sheet is answered, ask the server whether this account has a
 * welcome open. Only a brand-new account gets one (or one that started it
 * from Settings and has not finished), and that account lands in it on Chat;
 * everyone else keeps today's landing (Austin, 2026-10-25).
 */
export function WelcomeLauncher() {
	const { userId, isLoaded } = useAuth();
	const router = useRouter();
	const getToken = useStableGetToken();
	const consent = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot);
	// Declining AI means SureWord cannot talk, so there is no welcome to open.
	const consentGiven = consent.record !== null && !consent.prompt;
	const checkedFor = useRef<string | null>(null);
	const pathname = usePathname();
	const pathnameRef = useRef(pathname);
	pathnameRef.current = pathname;

	useEffect(() => {
		if (!isLoaded || !userId || !consentGiven || checkedFor.current === userId) return;
		checkedFor.current = userId;
		let cancelled = false;
		let settled = false;
		void (async () => {
			await hydrateOnboarding();
			const result = await startOnboarding(getToken, "auto");
			settled = true;
			if (cancelled || result.status !== "active") return;
			rememberWelcomeConversation(userId, result.conversationId);
			// A new welcome always opens. One already under way reopens only
			// over the default Chat landing, never over a notification or a
			// link that brought them somewhere else.
			if (!result.created && pathnameRef.current !== "/") return;
			router.navigate({ pathname: "/", params: { conversationId: result.conversationId } });
		})().catch(() => {
			// Offline: try again next launch. Nothing is lost; the server holds the welcome.
			checkedFor.current = null;
		});
		return () => {
			cancelled = true;
			// A dependency that changed mid-request (the consent sheet settling)
			// would otherwise leave this launch marked checked with no answer
			// acted on, and the welcome would not reopen until the next launch.
			if (!settled) checkedFor.current = null;
		};
	}, [isLoaded, userId, consentGiven, getToken, router]);

	return null;
}
