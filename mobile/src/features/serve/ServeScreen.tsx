import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Keyboard,
	KeyboardAvoidingView,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	type TextInput as NativeTextInput,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { AccentButton, GhostButton, GlassCard, Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	OptionChip,
	SectionLabel,
	SettingsSwitchRow,
	SettingsTopBar,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { SendWordSheet } from "@/features/shareCards/SendWordSheet";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import {
	addServeJournalEntry,
	deleteServeJournalEntry,
	fetchServeJournal,
	searchServeNearby,
} from "./api";
import {
	MAX_ENTRY_LENGTH,
	MAX_LOCATION_LENGTH,
	SERVE_MODES,
	SERVE_MODE_LABELS,
	entryDateLabel,
	isSearchableLocation,
	stepFor,
	stepLabel,
	telUrl,
	type ServeEntryView,
	type ServePlace,
	type ServeStep,
	type ServeView,
	type VerseView,
	type WayView,
} from "./serveRules";
import { useServe } from "./useServe";

/**
 * Ways to Serve (GitHub issue #28): optional, free ways to put faith into
 * action, offered and never required. Every word of doctrine on this screen
 * (the intro, each way, every verse, the journal's wording) is the server's,
 * so the four clients say exactly the same thing. Nothing here counts what a
 * reader has done: the journal lists entries without a total, and there is
 * no streak, score or badge anywhere.
 *
 * Mirrors the web page and `macos/Shared/Serve` on Apple.
 */
export default function ServeScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const settingsStyles = useSettingsStyles();
	const { colors } = useTheme();
	const bottom = useTabBarSpace();
	const serve = useServe();
	const view = serve.view;

	// Today's suggestion is per day, so returning to the screen re-asks.
	const { reload } = serve;
	useFocusEffect(useCallback(() => { reload(); }, [reload]));

	const scrollRef = useRef<ScrollView | null>(null);
	const nearbyY = useRef(0);
	const journalY = useRef(0);
	const locationRef = useRef<NativeTextInput | null>(null);
	const journalRef = useRef<NativeTextInput | null>(null);
	const [shareReference, setShareReference] = useState<string | null>(null);
	const [journalVerse, setJournalVerse] = useState<string | null>(null);

	// Android does not scroll a ScrollView to a focused input, so once the
	// keyboard is up (and the view above has shrunk to fit) bring the section
	// being typed in back into sight.
	const revealOnKeyboard = useCallback((sectionY: React.RefObject<number>) => {
		const reveal = () => scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current - spacing.lg), animated: true });
		if ((Keyboard.metrics()?.height ?? 0) > 0) {
			reveal();
			return;
		}
		const shown = Keyboard.addListener("keyboardDidShow", () => {
			shown.remove();
			// Let the padding layout settle before measuring the scroll.
			setTimeout(reveal, 50);
		});
	}, []);

	const openChat = useCallback(
		(prompt: string) => {
			router.navigate({ pathname: "/", params: { prompt, handoffId: String(Date.now()) } });
		},
		[router]
	);

	const runStep = useCallback(
		(step: ServeStep) => {
			switch (step.kind) {
				case "share-verse":
					setShareReference(step.reference);
					return;
				case "chat":
					openChat(step.prompt);
					return;
				case "nearby":
					scrollRef.current?.scrollTo({ y: Math.max(0, nearbyY.current - spacing.lg), animated: true });
					locationRef.current?.focus();
					return;
				case "church":
					router.push("/settings/church");
					return;
				case "url":
					void Linking.openURL(step.url);
					return;
				case "journal":
					setJournalVerse(step.reference);
					scrollRef.current?.scrollTo({ y: Math.max(0, journalY.current - spacing.lg), animated: true });
					journalRef.current?.focus();
					return;
			}
		},
		[openChat, router]
	);

	const stepOf = (way: WayView) =>
		view
			? stepFor(way, {
				nearbyAvailable: view.nearby.available,
				churchWebsite: view.church?.website ?? null,
				canShareVerse: true,
			})
			: null;

	return (
		<Screen>
			<SettingsTopBar title={view?.title ?? "Ways to Serve"} />
			<KeyboardAvoidingView style={styles.fill} behavior="padding">
			<ScrollView
				ref={scrollRef}
				contentContainerStyle={[settingsStyles.content, { paddingBottom: bottom + spacing.xl }]}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
			>
				{!view ? (
					<GlassCard style={[settingsStyles.card, styles.firstCard]}>
						{serve.error && !serve.loading ? (
							<View style={styles.retryRow}>
								<Text style={settingsStyles.hint}>{serve.error}</Text>
								<Pressable accessibilityRole="button" onPress={reload} hitSlop={8}>
									<Text style={styles.retry}>Retry</Text>
								</Pressable>
							</View>
						) : (
							<ActivityIndicator color={colors.accent} accessibilityLabel="Loading Ways to Serve" />
						)}
					</GlassCard>
				) : (
					<>
						<GlassCard style={[settingsStyles.card, styles.firstCard]}>
							<Text style={styles.body}>{view.intro.text}</Text>
							{view.intro.verses.map((verse) => (
								<Scripture key={verse.reference} verse={verse} />
							))}
						</GlassCard>

						<SectionLabel label="SUGGESTIONS" />
						<GlassCard style={settingsStyles.card}>
							<View style={settingsStyles.chipRow}>
								{SERVE_MODES.map((mode) => (
									<OptionChip
										key={mode}
										label={SERVE_MODE_LABELS[mode]}
										selected={view.settings.mode === mode}
										onPress={() => {
											if (view.settings.mode !== mode) serve.saveSettings({ mode });
										}}
									/>
								))}
							</View>
							<SettingsSwitchRow
								title="I already give to my church"
								value={view.settings.givesToChurch}
								onValueChange={(givesToChurch) => serve.saveSettings({ givesToChurch })}
							/>
						</GlassCard>

						{view.today ? (
							<>
								<SectionLabel label="TODAY" />
								<WayCard way={view.today} step={stepOf(view.today)} onStep={runStep} featured />
							</>
						) : null}

						{view.ways.length > 0 ? (
							<>
								<SectionLabel label="WAYS" />
								<View style={styles.list}>
									{view.ways.map((way) => (
										<WayCard key={way.id} way={way} step={stepOf(way)} onStep={runStep} />
									))}
								</View>
							</>
						) : null}

						{view.nearby.available ? (
							<View onLayout={(event) => { nearbyY.current = event.nativeEvent.layout.y; }}>
								<SectionLabel label="NEARBY" />
								<NearbySection
									getToken={getToken}
									searches={view.nearby.searches}
									inputRef={locationRef}
									onInputFocus={() => revealOnKeyboard(nearbyY)}
								/>
							</View>
						) : null}

						<View onLayout={(event) => { journalY.current = event.nativeEvent.layout.y; }}>
							<SectionLabel label={view.journal.title.toUpperCase()} />
							<JournalSection
								journal={view.journal}
								getToken={getToken}
								inputRef={journalRef}
								onInputFocus={() => revealOnKeyboard(journalY)}
								verseRef={journalVerse}
								onClearVerse={() => setJournalVerse(null)}
							/>
						</View>
					</>
				)}
			</ScrollView>
			</KeyboardAvoidingView>
			<SendWordSheet
				visible={shareReference !== null}
				verse={shareReference ? { reference: shareReference, translation: "KJV" } : null}
				onClose={() => setShareReference(null)}
			/>
		</Screen>
	);
}

/** A verse quoted as Scripture: the reader's verse face beside an accent rule. */
function Scripture({ verse }: { verse: VerseView }) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.quote} accessible accessibilityLabel={`${verse.text} ${verse.reference}, King James Version`}>
			{verse.text ? <Text style={styles.verseText}>{verse.text}</Text> : null}
			<Text style={styles.verseRef}>{verse.reference} · KJV</Text>
		</View>
	);
}

function WayCard({
	way,
	step,
	onStep,
	featured = false,
}: {
	way: WayView;
	step: ServeStep | null;
	onStep: (step: ServeStep) => void;
	featured?: boolean;
}) {
	const styles = useThemedStyles(createStyles);
	const settingsStyles = useSettingsStyles();
	return (
		<GlassCard style={settingsStyles.card} strong={featured}>
			<Text accessibilityRole="header" style={featured ? styles.featuredTitle : styles.wayTitle}>{way.title}</Text>
			{way.detail ? <Text style={styles.body}>{way.detail}</Text> : null}
			{featured ? <Scripture verse={way.verse} /> : <Text style={styles.verseRef}>{way.verse.reference} · KJV</Text>}
			{step ? (
				featured ? (
					<AccentButton label={stepLabel(step)} onPress={() => onStep(step)} />
				) : (
					<GhostButton label={stepLabel(step)} onPress={() => onStep(step)} />
				)
			) : null}
		</GlassCard>
	);
}

/**
 * Places near a city or ZIP the reader types. Never the device location: the
 * reader decides how precisely to say where they are, and the server stores
 * nothing about the search.
 */
function NearbySection({
	getToken,
	searches,
	inputRef,
	onInputFocus,
}: {
	getToken: ReturnType<typeof useStableGetToken>;
	searches: { id: string; label: string }[];
	inputRef: React.RefObject<NativeTextInput | null>;
	onInputFocus: () => void;
}) {
	const styles = useThemedStyles(createStyles);
	const settingsStyles = useSettingsStyles();
	const { colors } = useTheme();
	const [location, setLocation] = useState("");
	const [kind, setKind] = useState(searches[0]?.id ?? "food");
	const [results, setResults] = useState<ServePlace[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const latest = useRef(0);

	const search = useCallback(
		(searchKind: string) => {
			if (!isSearchableLocation(location)) {
				setError("Type a city or ZIP code first.");
				return;
			}
			const id = ++latest.current;
			setSearching(true);
			setError(null);
			searchServeNearby(getToken, location, searchKind)
				.then((response) => {
					if (id !== latest.current) return;
					if (response.status === "unavailable") {
						setResults(null);
						setError("Nearby search isn't available right now.");
						return;
					}
					setResults(response.results);
				})
				.catch((err: unknown) => {
					if (id !== latest.current) return;
					setError(err instanceof Error && err.message ? err.message : "Search failed. Try again.");
				})
				.finally(() => {
					if (id === latest.current) setSearching(false);
				});
		},
		[getToken, location]
	);

	return (
		<GlassCard style={settingsStyles.card}>
			<View style={styles.inputWrap}>
				<Ionicons name="location-outline" size={16} color={colors.textFaint} />
				<TextInput
					ref={inputRef}
					value={location}
					onChangeText={setLocation}
					onFocus={onInputFocus}
					placeholder="City or ZIP code"
					placeholderTextColor={colors.textGhost}
					accessibilityLabel="City or ZIP code"
					autoCorrect={false}
					maxLength={MAX_LOCATION_LENGTH}
					returnKeyType="search"
					onSubmitEditing={() => search(kind)}
					style={styles.input}
				/>
			</View>
			{searches.map((option) => (
				<View key={option.id} style={settingsStyles.chipRow}>
					<OptionChip
						label={option.label}
						selected={kind === option.id}
						onPress={() => {
							setKind(option.id);
							if (isSearchableLocation(location)) search(option.id);
						}}
					/>
				</View>
			))}
			<AccentButton label={searching ? "Searching..." : "Search"} disabled={searching} onPress={() => search(kind)} />
			{error ? <Text style={styles.error}>{error}</Text> : null}
			{results && results.length === 0 && !searching ? (
				<Text style={settingsStyles.hint}>Nothing found there. Try a nearby city.</Text>
			) : null}
			{results?.map((place) => (
				<View key={place.placeId} style={styles.place}>
					<Text style={styles.placeName}>{place.name}</Text>
					{place.address ? <Text style={styles.meta}>{place.address}</Text> : null}
					<View style={styles.placeLinks}>
						{place.mapsUrl ? (
							<PlaceLink icon="map-outline" label="Map" accessibilityLabel={`Open ${place.name} in Maps`} url={place.mapsUrl} />
						) : null}
						{place.website ? (
							<PlaceLink icon="globe-outline" label="Website" accessibilityLabel={`Open ${place.name}'s website`} url={place.website} />
						) : null}
						{place.phone ? (
							<PlaceLink icon="call-outline" label="Call" accessibilityLabel={`Call ${place.name}`} url={telUrl(place.phone)} />
						) : null}
					</View>
				</View>
			))}
		</GlassCard>
	);
}

function PlaceLink({
	icon,
	label,
	accessibilityLabel,
	url,
}: {
	icon: React.ComponentProps<typeof Ionicons>["name"];
	label: string;
	accessibilityLabel: string;
	url: string;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="link"
			accessibilityLabel={accessibilityLabel}
			onPress={() => void Linking.openURL(url)}
			style={({ pressed }) => [styles.placeLink, pressed && { backgroundColor: colors.surfacePressed }]}
		>
			<Ionicons name={icon} size={15} color={colors.accent} />
			<Text style={styles.placeLinkLabel}>{label}</Text>
		</Pressable>
	);
}

/** The private journal: the reader's own words, listed by date and never totalled. */
function JournalSection({
	journal,
	getToken,
	inputRef,
	onInputFocus,
	verseRef,
	onClearVerse,
}: {
	journal: ServeView["journal"];
	getToken: ReturnType<typeof useStableGetToken>;
	inputRef: React.RefObject<NativeTextInput | null>;
	onInputFocus: () => void;
	/** The verse of the way that opened the journal, saved with the entry. */
	verseRef: string | null;
	onClearVerse: () => void;
}) {
	const styles = useThemedStyles(createStyles);
	const settingsStyles = useSettingsStyles();
	const { colors } = useTheme();
	const { userId } = useAuth();
	const [entries, setEntries] = useState<ServeEntryView[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState<string | null>(null);

	const load = useCallback(() => {
		setLoadError(null);
		fetchServeJournal(getToken)
			.then(setEntries)
			.catch((err: unknown) => setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load your journal."));
	}, [getToken]);

	// Keyed on the account so a different signed-in reader never sees these.
	useEffect(() => {
		setEntries(null);
		if (userId) load();
	}, [load, userId]);

	const save = () => {
		const text = draft.trim();
		if (!text || saving) return;
		setSaving(true);
		addServeJournalEntry(getToken, text, verseRef)
			.then((entry) => {
				setEntries((current) => [entry, ...(current ?? [])]);
				setDraft("");
				onClearVerse();
			})
			.catch((err: unknown) =>
				Alert.alert("Couldn't save that", err instanceof Error && err.message ? err.message : "Try again.")
			)
			.finally(() => setSaving(false));
	};

	const confirmDelete = (entry: ServeEntryView) => {
		Alert.alert("Delete this entry?", "It will be removed from your journal.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Delete",
				style: "destructive",
				onPress: () => {
					setDeleting(entry.id);
					deleteServeJournalEntry(getToken, entry.id)
						.then(() => setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id)))
						.catch((err: unknown) =>
							Alert.alert("Couldn't delete that", err instanceof Error && err.message ? err.message : "Try again.")
						)
						.finally(() => setDeleting(null));
				},
			},
		]);
	};

	return (
		<GlassCard style={settingsStyles.card}>
			{journal.prompt ? <Text style={styles.body}>{journal.prompt}</Text> : null}
			<Scripture verse={journal.verse} />
			<TextInput
				ref={inputRef}
				value={draft}
				onChangeText={setDraft}
				onFocus={onInputFocus}
				placeholder="Write what happened"
				placeholderTextColor={colors.textGhost}
				accessibilityLabel="Journal entry"
				multiline
				maxLength={MAX_ENTRY_LENGTH}
				editable={!saving}
				style={[styles.inputWrap, styles.journalInput]}
			/>
			{verseRef ? (
				<View style={styles.retryRow}>
					<Text style={styles.body}>With {verseRef}</Text>
					<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${verseRef}`} onPress={onClearVerse} hitSlop={8}>
						<Text style={styles.retry}>Remove</Text>
					</Pressable>
				</View>
			) : null}
			<AccentButton label={saving ? "Saving..." : "Save"} disabled={saving || draft.trim().length === 0} onPress={save} />
			{loadError ? (
				<View style={styles.retryRow}>
					<Text style={styles.error}>{loadError}</Text>
					<Pressable accessibilityRole="button" onPress={load} hitSlop={8}>
						<Text style={styles.retry}>Retry</Text>
					</Pressable>
				</View>
			) : entries === null ? (
				<ActivityIndicator color={colors.accent} accessibilityLabel="Loading your journal" />
			) : (
				entries.map((entry) => (
					<View key={entry.id} style={styles.entry}>
						<View style={styles.entryHeader}>
							<Text style={styles.meta}>
								{[entryDateLabel(entry.createdAt), entry.verseRef].filter(Boolean).join(" · ")}
							</Text>
							{deleting === entry.id ? (
								<ActivityIndicator size="small" color={colors.danger} />
							) : (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Delete this entry"
									onPress={() => confirmDelete(entry)}
									hitSlop={8}
								>
									<Ionicons name="trash-outline" size={16} color={colors.textFaint} />
								</Pressable>
							)}
						</View>
						<Text style={styles.body}>{entry.text}</Text>
					</View>
				))
			)}
		</GlassCard>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		firstCard: { marginTop: spacing.xl },
		list: { gap: spacing.md },
		body: { ...typography.support, color: c.textSecondary },
		meta: { ...typography.meta, color: c.textFaint, flexShrink: 1 },
		quote: {
			gap: spacing.xs,
			borderLeftWidth: 2,
			borderLeftColor: c.accentBorder,
			paddingLeft: spacing.md,
		},
		verseText: { color: c.text, fontFamily: fonts.verse, fontSize: 20, lineHeight: 27 },
		verseRef: { ...typography.micro, color: c.textMuted, letterSpacing: 1 },
		wayTitle: { ...typography.control, color: c.text, fontWeight: "700" },
		featuredTitle: { color: c.accent, fontFamily: fonts.verse, fontSize: 26, lineHeight: 31 },
		retryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
		retry: { ...typography.meta, color: c.accent, fontWeight: "700" },
		error: { ...typography.support, color: c.danger, flexShrink: 1 },
		inputWrap: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			minHeight: 44,
			backgroundColor: c.bgElevated,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
		},
		input: { flex: 1, minWidth: 0, color: c.text, paddingVertical: spacing.sm },
		journalInput: { minHeight: 96, color: c.text, paddingVertical: spacing.sm, textAlignVertical: "top" },
		place: {
			gap: spacing.xs,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			padding: spacing.md,
		},
		placeName: { ...typography.control, color: c.text, fontWeight: "600" },
		placeLinks: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
		placeLink: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			minHeight: 36,
			paddingHorizontal: spacing.md,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
		},
		placeLinkLabel: { ...typography.meta, color: c.accent, fontWeight: "700" },
		entry: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
		entryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
	});
