import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { getKjvChapter } from "@/features/bible/kjv";
import { useSettings, useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { fetchLearnSuggestions, fetchLearnToday, reviewLearnCard } from "./api";
import { type LearnResult } from "./learn";
import { LearnSyncStore, type LearnSyncSnapshot } from "./learnSync";
import { LearnTokenBridge } from "./learnTokenBridge";
import {
	chooseLearnMode,
	resolveLearnMode,
	type LearnMode,
	type LearnModeSelection,
} from "./practice";
import { VersePractice } from "./VersePractice";
import { SuggestedVerses } from "./SuggestedVerses";
import {
	addedConfirmation,
	learnSuggestionsView,
	suggestionKey,
	type LearnSuggestion,
} from "./suggestions";

const RETRY_DELAYS_MS = [1_500, 5_000, 15_000] as const;

export default function LearnScreen() {
	const { userId, isLoaded } = useAuth();
	if (!isLoaded) return <Screen><Text>Loading your verses...</Text></Screen>;
	if (!userId) return <Screen><Text>Sign in to learn your verses.</Text></Screen>;
	return <LearnSession key={userId} userId={userId} />;
}

function LearnSession({ userId }: { userId: string }) {
	const { getToken } = useAuth();
	const [tokenBridge] = useState(() => new LearnTokenBridge(getToken));
	useEffect(() => tokenBridge.update(getToken), [getToken, tokenBridge]);
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	// LearnScreen keys this component by account, so this store owns exactly one
	// account session. Clerk may replace getToken while restoring a session; the
	// bridge picks up that function without replacing a hydrating store.
	const [store] = useState(() => new LearnSyncStore(userId, {
		storage: AsyncStorage,
		fetchToday: () => fetchLearnToday(tokenBridge.getToken),
		sendReview: (cardId, payload) => reviewLearnCard(tokenBridge.getToken, cardId, payload),
		createOperationId: () => Crypto.randomUUID(),
		now: () => new Date(),
		timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
	}));
	const [snapshot, setSnapshot] = useState<LearnSyncSnapshot>(() => store.getSnapshot());
	// A finished review starts a fresh round even when the card stays on screen.
	const [round, setRound] = useState(0);
	const [selection, setSelection] = useState<LearnModeSelection | null>(null);
	const [typedRound, setTypedRound] = useState<string | null>(null);
	const [interactionBusy, setInteractionBusy] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [suggestions, setSuggestions] = useState<LearnSuggestion[]>([]);
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
	const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
	const [confirmation, setConfirmation] = useState<string | null>(null);
	const { translation } = useSettings();
	const suggestionsRequest = useRef(false);
	const visible = useRef(false);
	const retryAttempt = useRef(0);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const runSyncRef = useRef<(reset?: boolean) => void>(() => undefined);
	const touch = useRef<{ x: number; y: number } | null>(null);

	const clearRetry = useCallback(() => {
		if (retryTimer.current) clearTimeout(retryTimer.current);
		retryTimer.current = null;
	}, []);

	const runSync = useCallback((reset = false) => {
		if (!visible.current || !store.getSnapshot().hydrated) return;
		if (reset) retryAttempt.current = 0;
		clearRetry();
		void store.synchronize().then(() => {
			const next = store.getSnapshot();
			if (!visible.current || next.connection !== "offline" ||
				retryAttempt.current >= RETRY_DELAYS_MS.length) return;
			const delay = RETRY_DELAYS_MS[retryAttempt.current++];
			retryTimer.current = setTimeout(() => runSyncRef.current(false), delay);
		});
	}, [clearRetry, store]);
	runSyncRef.current = runSync;

	const loadSuggestions = useCallback(async () => {
		if (suggestionsRequest.current) return;
		suggestionsRequest.current = true;
		// Additive: fetchLearnSuggestions never rejects, so an offline device or
		// a deploy without this endpoint simply shows no suggestions, and the
		// next focus tries again.
		try {
			setSuggestions(await fetchLearnSuggestions(tokenBridge.getToken));
		} finally {
			suggestionsRequest.current = false;
		}
	}, [tokenBridge]);
	const loadSuggestionsRef = useRef(loadSuggestions);
	loadSuggestionsRef.current = loadSuggestions;

	useEffect(() => {
		store.activate();
		const unsubscribe = store.subscribe(setSnapshot);
		void store.hydrate().then(() => runSyncRef.current(true)).catch(() => undefined);
		return () => {
			clearRetry();
			unsubscribe();
			store.dispose();
		};
	}, [clearRetry, store]);

	useFocusEffect(useCallback(() => {
		visible.current = true;
		runSyncRef.current(true);
		void loadSuggestionsRef.current();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") runSyncRef.current(true);
		});
		return () => {
			visible.current = false;
			clearRetry();
			subscription.remove();
		};
	}, [clearRetry]));

	const today = snapshot.today;
	const card = today?.cards[0];
	let verseText = card?.text ?? "";
	if (card?.translation === "KJV") {
		try {
			verseText = getKjvChapter(card.book, card.chapter)[card.verse - 1] || verseText;
		} catch {
			// The matching server text remains available when the bundle has no entry.
		}
	}
	// How well the verse is known picks the mode; the reader may change it for
	// the card in front of them, and nothing about that reaches the server.
	const practice = card ? resolveLearnMode(card, selection) : null;
	const mode: LearnMode = practice?.mode ?? "blanks";
	const practiceRound = card ? `${card.id}:${card.revision}:${round}:${mode}` : "";
	// Type it out passes "good" only when every word matched, so a swipe and the
	// button answer to the same gate.
	const typedReady = mode !== "typed" || (Boolean(practiceRound) && typedRound === practiceRound);
	const conflict = snapshot.conflicts[0];
	const cardBlocked = Boolean(card && snapshot.conflicts.some((item) => item.cardId === card.id));
	const suggestionsView = learnSuggestionsView({
		suggestions,
		dismissed,
		added,
		hasCard: Boolean(card),
	});

	const dismissSuggestion = (suggestion: LearnSuggestion) => {
		setDismissed((old) => new Set(old).add(suggestionKey(suggestion)));
	};

	const acceptSuggestion = (suggestion: LearnSuggestion) => {
		setAdded((old) => new Set(old).add(suggestionKey(suggestion)));
		setConfirmation(addedConfirmation(suggestion.reference));
		// With nothing due, the added verse is the session. The store owns the
		// queue, so a sync is what brings the new card and count in.
		if (!card) runSyncRef.current(true);
	};

	const review = async (result: LearnResult) => {
		if (!card || interactionBusy || cardBlocked || !verseText.trim()) return;
		if (result === "good" && !typedReady) return;
		const wasOffline = store.getSnapshot().connection === "offline";
		setInteractionBusy(true);
		setLocalError(null);
		try {
			await store.enqueue(card.id, result);
			setRound((value) => value + 1);
			if (!wasOffline) runSyncRef.current(false);
		} catch (error) {
			setLocalError(error instanceof Error ? error.message : "Could not save this review.");
		} finally {
			setInteractionBusy(false);
		}
	};

	const useLatest = async () => {
		if (!conflict || interactionBusy) return;
		setInteractionBusy(true);
		setLocalError(null);
		try {
			await store.useLatestSchedule(conflict.cardId);
			setRound((value) => value + 1);
		} catch (error) {
			setLocalError(error instanceof Error ? error.message : "Could not load the latest schedule.");
		} finally {
			setInteractionBusy(false);
		}
	};

	const disabled = interactionBusy || cardBlocked || !verseText.trim();
	const showInitialLoading = !today &&
		(snapshot.connection === "initializing" || snapshot.connection === "syncing");
	const pendingLabel = `${snapshot.pendingCount} saved review${snapshot.pendingCount === 1 ? "" : "s"}`;

	return <Screen edges={["top", "bottom"]}>
		<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
			<View style={styles.header}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Back to Bible"
					onPress={() => router.replace("/(app)/bible")}
					style={styles.back}
				>
					<Text style={styles.link}>‹ Bible</Text>
				</Pressable>
				<Text style={styles.title}>Learn a verse</Text>
				{today ? <Text style={styles.count}>{today.knownCount} verses you know</Text> : <View />}
			</View>

			{conflict ? <View accessibilityRole="alert" style={styles.conflictNotice}>
				<Text style={styles.noticeTitle}>Newer schedule found for {conflict.reference}</Text>
				<Text style={styles.muted}>
					{conflict.operationCount} local review{conflict.operationCount === 1 ? "" : "s"} cannot be applied to that newer stage.
				</Text>
				<Pressable
					accessibilityRole="button"
					disabled={interactionBusy}
					onPress={() => void useLatest()}
					style={[styles.noticeButton, interactionBusy && styles.disabled]}
				>
					<Text style={styles.link}>Use latest schedule</Text>
				</Pressable>
			</View> : null}

			{snapshot.pendingCount > 0 && !conflict ? <View style={styles.notice}>
				<Text style={styles.muted}>
					{snapshot.connection === "syncing"
						? `Syncing ${pendingLabel}...`
						: `${pendingLabel} on this device. ${snapshot.connection === "idle" ? "Ready to sync." : "Waiting to sync."}`}
				</Text>
				{snapshot.connection !== "syncing" ? <Pressable
					accessibilityRole="button"
					onPress={() => runSyncRef.current(true)}
					style={styles.noticeButton}
				>
					<Text style={styles.link}>Retry sync</Text>
				</Pressable> : null}
			</View> : null}

			{snapshot.pendingCount === 0 && snapshot.connection === "offline" ? <View style={styles.notice}>
				<Text style={styles.muted}>{snapshot.message}</Text>
				<Pressable accessibilityRole="button" onPress={() => runSyncRef.current(true)} style={styles.noticeButton}>
					<Text style={styles.link}>Reconnect</Text>
				</Pressable>
			</View> : null}

			{(localError || (snapshot.connection === "error" && snapshot.message)) ? <View accessibilityRole="alert" style={styles.errorNotice}>
				<Text style={styles.errorText}>{localError ?? snapshot.message}</Text>
				{snapshot.hydrated ? <Pressable accessibilityRole="button" onPress={() => runSyncRef.current(true)} style={styles.noticeButton}>
					<Text style={styles.link}>Try again</Text>
				</Pressable> : null}
			</View> : null}

			{showInitialLoading ? <Text accessibilityLiveRegion="polite" style={styles.empty}>Loading your verses...</Text> : null}
			{!today && !showInitialLoading ? <View style={styles.study}>
				<Text style={styles.emptyTitle}>Connect to download your practice verses.</Text>
				<Text style={styles.hint}>Once downloaded, this session works without a connection.</Text>
			</View> : null}
			{today && !card && suggestionsView.showEmptyText ? <View style={styles.study}>
				<Text style={styles.emptyTitle}>No verses are due right now.</Text>
				<Text style={styles.hint}>
					{snapshot.pendingCount
						? "Your practice is saved on this device and will update the schedule after it syncs."
							: today.queueCount
							? "Your next verses will be ready when they are due."
							: snapshot.downloadedCards.length
								? "Your downloaded verses remain saved for the next offline practice session."
								: "Choose Learn this verse from the Bible reader or a highlight."}
				</Text>
			</View> : null}

			{card ? <View
				style={styles.study}
				onTouchStart={(event) => {
					touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
				}}
				onTouchEnd={(event) => {
					const start = touch.current;
					touch.current = null;
					if (start && start.x - event.nativeEvent.pageX > 70 &&
						Math.abs(start.y - event.nativeEvent.pageY) < 45) void review("good");
				}}
			>
				<Text style={styles.reference}>{card.reference} · {card.translation}</Text>
				{verseText.trim() ? <>
					<VersePractice
						key={practiceRound}
						mode={mode}
						text={verseText}
						stage={card.stage}
						seed={card.revision}
						disabled={disabled}
						onModeChange={(next) => setSelection(chooseLearnMode(card, next))}
						onTypedScore={(perfect) => setTypedRound(perfect ? practiceRound : null)}
					/>
					<View style={styles.actions}>
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ disabled }}
							disabled={disabled}
							onPress={() => void review("again")}
							style={[styles.button, disabled && styles.disabled]}
						>
							<Text style={styles.buttonText}>Practice again</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ disabled: disabled || !typedReady }}
							disabled={disabled || !typedReady}
							onPress={() => void review("good")}
							style={[styles.button, { backgroundColor: colors.accent }, (disabled || !typedReady) && styles.disabled]}
						>
							<Text style={styles.primaryText}>{interactionBusy ? "Saving..." : card.stage === 3 ? "I remembered" : "Continue"}</Text>
						</Pressable>
					</View>
				</> : <View accessibilityRole="alert" style={styles.unavailable}>
					<Text style={styles.noticeTitle}>{card.translation} text is temporarily unavailable.</Text>
					<Text style={styles.muted}>Reconnect and reload before practicing this verse. SureWord will keep the requested translation.</Text>
					<Pressable accessibilityRole="button" onPress={() => runSyncRef.current(true)} style={styles.noticeButton}>
						<Text style={styles.link}>Reload verse</Text>
					</Pressable>
				</View>}
			</View> : null}

			{today ? <SuggestedVerses
				view={suggestionsView}
				translation={translation}
				confirmation={confirmation}
				onAdded={acceptSuggestion}
				onDismiss={dismissSuggestion}
			/> : null}
		</ScrollView>
	</Screen>;
}

const createStyles = (colors: Colors) => StyleSheet.create({
	content: { flexGrow: 1, padding: spacing.xl, gap: spacing.lg },
	header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
	back: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
	link: { color: colors.accent, fontSize: 15, fontFamily: fonts.bodyBold },
	title: { color: colors.text, fontSize: 16, fontFamily: fonts.bodyBold },
	count: { color: colors.textMuted, fontSize: 13 },
	notice: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.md },
	conflictNotice: { borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: spacing.md },
	errorNotice: { borderWidth: 1, borderColor: colors.dangerBorder, backgroundColor: colors.dangerSoft, borderRadius: radius.lg, padding: spacing.md },
	noticeTitle: { color: colors.text, fontSize: 15, lineHeight: 22, fontFamily: fonts.bodyBold },
	muted: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
	errorText: { color: colors.danger, fontSize: 15, lineHeight: 22 },
	noticeButton: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: spacing.sm, paddingHorizontal: spacing.sm },
	study: { flex: 1, justifyContent: "center", paddingVertical: spacing.xl },
	reference: { color: colors.accent, fontFamily: fonts.bodyBold, textAlign: "center", fontSize: 16, marginBottom: spacing.xl },
	hint: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: spacing.xl },
	actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
	button: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.md, alignItems: "center", justifyContent: "center" },
	buttonText: { color: colors.text, fontFamily: fonts.bodyBold, textAlign: "center" },
	primaryText: { color: "#111", fontFamily: fonts.bodyBold, textAlign: "center" },
	disabled: { opacity: 0.5 },
	empty: { color: colors.textMuted, textAlign: "center", marginVertical: spacing.xl },
	emptyTitle: { color: colors.text, fontFamily: fonts.verse, fontSize: 28, lineHeight: 36, textAlign: "center" },
	unavailable: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, padding: spacing.lg },
});
