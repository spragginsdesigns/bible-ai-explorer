import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { meshGradients, palettes, type Colors, type ResolvedTheme } from "@/theme";
import { parseTranslationId, type BibleLanguage, type TranslationId } from "@/features/bible/translations";
import { DEFAULT_LISTEN_RATE, normalizeListenRate } from "@/features/cross/listen";
import { TEXT_SCALE_FACTORS, normalizeTextScale, type TextScale } from "./textScale";
import { bibleForLanguage, normalizeAnswerLanguage, type AnswerLanguage } from "./answerLanguage";
import { effectiveAnswerLanguage } from "./effectiveLanguage";
import {
	DEFAULT_SYNCED_SETTINGS,
	settingsFromDocument,
	type PreferencesDocument,
	type PreferencesPatch,
	EMPTY_HIGHLIGHT_LABELS,
	normalizeHighlightLabels,
	normalizeHighlightMeanings,
	normalizePersonalText,
	type HighlightLabels,
	type HighlightMeanings,
	type PersonalTextField,
} from "./preferences";

/**
 * Persisted user settings (appearance + Bible translation), modeled on
 * notesStore: a module-level snapshot exposed through useSyncExternalStore,
 * hydrated from / persisted to AsyncStorage. Everything visual in the app
 * reads its palette through the hooks here so a theme change re-renders
 * the whole tree with the new colors.
 *
 * Every field except `themeMode` is an account preference owned by the server
 * (`/api/preferences`): AsyncStorage is a first-paint cache of the account
 * document, not the record. Setters therefore update locally and write through
 * (see `setPreferencesWriter`), while the hydrate path and the model picker's
 * own bookkeeping use the `*Local` setters, which must not write back.
 */

export type ThemeMode = "system" | "dark" | "light";

export interface Settings {
	themeMode: ThemeMode;
	translation: TranslationId;
	/** Bible reader parchment page surface (Settings -> Appearance). */
	parchment: boolean;
	/**
	 * Show the LC Greek in the reader on a book that has it (LC-15842). A device
	 * setting like `themeMode`: it never leaves the phone.
	 */
	lcGreek: boolean;
	/**
	 * Offer "Quiz me" at the end of each chapter in the reader. A device setting
	 * like `lcGreek`: it never leaves the phone. Default on.
	 */
	quizOffer: boolean;
	/** Chat model/effort picks, sent with every chat request. Null = server default. */
	chatModelId: string | null;
	chatEffort: string | null;
	/**
	 * The rest of the run options from the model picker. Unlike chatEffort these
	 * store their default explicitly ("standard" / "medium" / "standard"): the
	 * server reads a null as "no opinion, apply the account default", so a null
	 * would leave someone who once picked Fast running Fast forever. Null here
	 * therefore means only "never chose". Stored raw, so a value the current
	 * model rejects survives a detour through another model.
	 */
	chatSpeed: string | null;
	chatVerbosity: string | null;
	chatMode: string | null;
	/** Playback speed for the Listen devotional. Synced with the account. */
	listenRate: number;
	/** App-wide text size, applied by AppText. Synced with the account. */
	textScale: TextScale;
	/** The language SureWord answers in; "auto" follows the device. Synced with the account. */
	answerLanguage: AnswerLanguage;
	/** Walk with me reads SureWord's messages aloud. Synced with the account. */
	voiceMode: boolean;
	/** Account highlight names. Null until this account has hydrated. */
	highlightLabels: HighlightLabels | null;
	/** What each colour means to the user. Null until this account has hydrated. */
	highlightMeanings: HighlightMeanings | null;
	/** The user's own description of themselves. Null until this account has hydrated. */
	aboutMe: string | null;
	/** How the user came to faith, private to the assistant. Null until hydrated. */
	testimony: string | null;
}

const STORAGE_KEY = "sureword.settings.v1";

// The synced half comes from the contract module, so the first-adopt seed and
// this store can never disagree about what "never chosen" looks like.
const DEFAULT_SETTINGS: Settings = {
	themeMode: "system",
	lcGreek: false,
	quizOffer: true,
	...DEFAULT_SYNCED_SETTINGS,
};

let snapshot: Settings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function setSnapshot(next: Settings) {
	// Server syncs re-apply unchanged values often, and every emit re-renders each subscriber.
	const keys = new Set([...Object.keys(snapshot), ...Object.keys(next)] as (keyof Settings)[]);
	if ([...keys].every((key) => Object.is(snapshot[key], next[key]))) return;
	snapshot = next;
	persist();
	listeners.forEach((listener) => listener());
}

function persist() {
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {});
}

/** Load the saved settings once at startup (root layout holds the splash). */
export async function hydrateSettings(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<Settings>;
		snapshot = {
			themeMode:
				parsed.themeMode === "dark" || parsed.themeMode === "light" || parsed.themeMode === "system"
					? parsed.themeMode
					: DEFAULT_SETTINGS.themeMode,
			translation: parseTranslationId(parsed.translation) ?? DEFAULT_SETTINGS.translation,
			parchment: parsed.parchment !== false,
			lcGreek: parsed.lcGreek === true,
			// Default on, so a cache from before the setting existed keeps the offer.
			quizOffer: parsed.quizOffer !== false,
			chatModelId: typeof parsed.chatModelId === "string" ? parsed.chatModelId : null,
			chatEffort: typeof parsed.chatEffort === "string" ? parsed.chatEffort : null,
			// This list is a whitelist, not a merge: a run option missing here is
			// written to storage and then dropped on the next launch.
			chatSpeed: typeof parsed.chatSpeed === "string" ? parsed.chatSpeed : null,
			chatVerbosity: typeof parsed.chatVerbosity === "string" ? parsed.chatVerbosity : null,
			chatMode: typeof parsed.chatMode === "string" ? parsed.chatMode : null,
			// Normalized rather than trusted: a rate this build no longer offers
			// would leave the speed chip outside its own cycle.
			listenRate: normalizeListenRate(parsed.listenRate),
			textScale: normalizeTextScale(parsed.textScale),
			answerLanguage: normalizeAnswerLanguage(parsed.answerLanguage),
			voiceMode: parsed.voiceMode === true,
			highlightLabels:
				parsed.highlightLabels && typeof parsed.highlightLabels === "object"
					? normalizeHighlightLabels(parsed.highlightLabels)
					: null,
			highlightMeanings:
				parsed.highlightMeanings && typeof parsed.highlightMeanings === "object"
					? normalizeHighlightMeanings(parsed.highlightMeanings)
					: null,
			// Capped on the way in as well as out: a cache written by a build
			// with a larger cap must not be handed back over the current one.
			aboutMe:
				typeof parsed.aboutMe === "string" ? normalizePersonalText("aboutMe", parsed.aboutMe) : null,
			testimony:
				typeof parsed.testimony === "string"
					? normalizePersonalText("testimony", parsed.testimony)
					: null,
		};
	} catch {
		// A corrupt or unreadable store falls back to defaults.
	}
}

/**
 * Sends one changed key to `PATCH /api/preferences`. `revert` undoes the
 * optimistic local write and is called only when the server rejects it.
 * `preferencesSync` registers the real writer for the signed-in session; while
 * none is registered (signed out, or before the app shell mounts) changes stay
 * local, which is exactly what the contract asks for on 401.
 */
export type PreferencesWriter = (patch: PreferencesPatch, revert: () => void) => void;

let preferencesWriter: PreferencesWriter | null = null;

export function setPreferencesWriter(writer: PreferencesWriter | null) {
	preferencesWriter = writer;
}

function writeThrough(patch: PreferencesPatch, revert: () => void) {
	preferencesWriter?.(patch, revert);
}

/**
 * A revert that undoes one field, and only if that field still holds the value
 * the failed write put there.
 *
 * A PATCH can fail long after the user has moved on. Restoring a whole captured
 * snapshot would undo everything they did while it was in flight, and even
 * restoring one field blindly would clobber a newer choice of that same field
 * with a value two edits old. Whoever wrote last wins.
 */
function revertIfUnchanged<K extends keyof Settings>(
	field: K,
	wrote: Settings[K],
	previous: Settings[K]
): () => void {
	return () => {
		if (snapshot[field] !== wrote) return;
		setSnapshot({ ...snapshot, [field]: previous });
	};
}

/** Device setting by decision, so it never leaves the phone. */
export function setThemeMode(themeMode: ThemeMode) {
	setSnapshot({ ...snapshot, themeMode });
}

/** Device setting by decision, like the theme. */
export function setLcGreek(lcGreek: boolean) {
	setSnapshot({ ...snapshot, lcGreek });
}

/** Device setting by decision, like the theme. */
export function setQuizOffer(quizOffer: boolean) {
	setSnapshot({ ...snapshot, quizOffer });
}

export function setBibleTranslation(translation: TranslationId) {
	const previous = snapshot.translation;
	setSnapshot({ ...snapshot, translation });
	writeThrough({ translation }, revertIfUnchanged("translation", translation, previous));
}

export function setParchmentEnabled(parchment: boolean) {
	const previous = snapshot.parchment;
	setSnapshot({ ...snapshot, parchment });
	writeThrough({ parchment }, revertIfUnchanged("parchment", parchment, previous));
}

export function setChatModel(chatModelId: string | null) {
	const previous = snapshot.chatModelId;
	setSnapshot({ ...snapshot, chatModelId });
	writeThrough(
		{ chat: { modelId: chatModelId } },
		revertIfUnchanged("chatModelId", chatModelId, previous)
	);
}

export function setChatEffort(chatEffort: string | null) {
	const previous = snapshot.chatEffort;
	setSnapshot({ ...snapshot, chatEffort });
	writeThrough(
		{ chat: { effort: chatEffort } },
		revertIfUnchanged("chatEffort", chatEffort, previous)
	);
}

export function setChatSpeed(chatSpeed: string | null) {
	const previous = snapshot.chatSpeed;
	setSnapshot({ ...snapshot, chatSpeed });
	writeThrough(
		{ chat: { speed: chatSpeed } },
		revertIfUnchanged("chatSpeed", chatSpeed, previous)
	);
}

export function setChatVerbosity(chatVerbosity: string | null) {
	const previous = snapshot.chatVerbosity;
	setSnapshot({ ...snapshot, chatVerbosity });
	writeThrough(
		{ chat: { verbosity: chatVerbosity } },
		revertIfUnchanged("chatVerbosity", chatVerbosity, previous)
	);
}

export function setChatMode(chatMode: string | null) {
	const previous = snapshot.chatMode;
	setSnapshot({ ...snapshot, chatMode });
	writeThrough({ chat: { mode: chatMode } }, revertIfUnchanged("chatMode", chatMode, previous));
}

export function setListenRate(listenRate: number) {
	const previous = snapshot.listenRate;
	const next = normalizeListenRate(listenRate);
	setSnapshot({ ...snapshot, listenRate: next });
	writeThrough({ listenRate: next }, revertIfUnchanged("listenRate", next, previous));
}

export function setTextScale(textScale: TextScale) {
	const previous = snapshot.textScale;
	const next = normalizeTextScale(textScale);
	setSnapshot({ ...snapshot, textScale: next });
	writeThrough({ textScale: next }, revertIfUnchanged("textScale", next, previous));
}

export function setAnswerLanguage(answerLanguage: AnswerLanguage) {
	const previous = snapshot.answerLanguage;
	setSnapshot({ ...snapshot, answerLanguage });
	writeThrough({ answerLanguage }, revertIfUnchanged("answerLanguage", answerLanguage, previous));
}

/**
 * Settings > Language. A specific language also opens that language's Bible
 * when the reader's current one is in another language; "Follow my device"
 * leaves the Bible alone.
 */
export function chooseAnswerLanguage(answerLanguage: AnswerLanguage) {
	setAnswerLanguage(answerLanguage);
	if (answerLanguage === "auto") return;
	const bible = bibleForLanguage(snapshot.translation, answerLanguage);
	if (bible !== snapshot.translation) setBibleTranslation(bible);
}

export function setVoiceMode(voiceMode: boolean) {
	const previous = snapshot.voiceMode;
	setSnapshot({ ...snapshot, voiceMode });
	writeThrough({ voiceMode }, revertIfUnchanged("voiceMode", voiceMode, previous));
}

const selectTextScale = (settings: Settings) => settings.textScale;

/** How much bigger AppText draws, from the account's text size. */
export function useTextScaleFactor(): number {
	return TEXT_SCALE_FACTORS[useSettingsSelector(selectTextScale)] ?? 1;
}

/**
 * Adopt the colour text confirmed by the preferences endpoint without writing
 * it back. Both maps land together because they are saved together: the section
 * sends one PATCH carrying whichever rows the user touched.
 */
export function setHighlightLabelsAndMeaningsFromServer(
	highlightLabels: HighlightLabels,
	highlightMeanings: HighlightMeanings
) {
	setSnapshot({
		...snapshot,
		highlightLabels: normalizeHighlightLabels(highlightLabels),
		highlightMeanings: normalizeHighlightMeanings(highlightMeanings),
	});
}

/**
 * Adopt a personal text field (About me, testimony) confirmed by the endpoint,
 * without writing it back.
 */
export function setPersonalTextFromServer(field: PersonalTextField, text: string) {
	setSnapshot({ ...snapshot, [field]: normalizePersonalText(field, text) });
}

/*
 * Local-only chat setters. The model picker uses these for the two writes that
 * are bookkeeping rather than a user's choice: pinning the house model when the
 * account has no key of its own, and adopting the account defaults the server
 * already applies. PATCHing either would tell the server something it just told
 * us, and the house pin would overwrite the pick this account made back when it
 * still had a key.
 */

export function setChatModelLocal(chatModelId: string | null) {
	setSnapshot({ ...snapshot, chatModelId });
}

export function setChatEffortLocal(chatEffort: string | null) {
	setSnapshot({ ...snapshot, chatEffort });
}

export function setChatSpeedLocal(chatSpeed: string | null) {
	setSnapshot({ ...snapshot, chatSpeed });
}

export function setChatVerbosityLocal(chatVerbosity: string | null) {
	setSnapshot({ ...snapshot, chatVerbosity });
}

export function setChatModeLocal(chatMode: string | null) {
	setSnapshot({ ...snapshot, chatMode });
}

/**
 * Adopt a server document wholesale. Every synced field is overwritten even
 * when local already has a value - the account row is the record, and a device
 * that quietly kept its own translation is the bug this replaces. Never writes
 * back, or a hydrate would echo itself.
 */
export function applyServerPreferences(doc: PreferencesDocument) {
	setSnapshot({ ...snapshot, ...settingsFromDocument(doc) });
}

/**
 * Drop the synced fields when the cache turns out to belong to another
 * account. `themeMode`, `lcGreek` and `quizOffer` survive: they are device
 * settings, and flipping the app to dark mid-session on a user switch would be
 * startling and wrong.
 */
export function resetSyncedSettings() {
	setSnapshot({
		...DEFAULT_SETTINGS,
		themeMode: snapshot.themeMode,
		lcGreek: snapshot.lcGreek,
		quizOffer: snapshot.quizOffer,
	});
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useSettings(): Settings {
	return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Subscribe to one slice. Every themed component reads the theme, so through
 * useSettings any setting change (a model pick, a listen rate) re-rendered all
 * of them; with a selector only a change to the slice does. Return a primitive
 * or a reference held in the snapshot, never a fresh object.
 */
export function useSettingsSelector<T>(select: (settings: Settings) => T): T {
	return useSyncExternalStore(subscribe, () => select(snapshot));
}

const selectThemeMode = (settings: Settings) => settings.themeMode;
const selectHighlightLabels = (settings: Settings) => settings.highlightLabels;

/** Reader-facing hook. An unhydrated account uses the standard hue names. */
export function useHighlightLabels(): HighlightLabels {
	return useSettingsSelector(selectHighlightLabels) ?? EMPTY_HIGHLIGHT_LABELS;
}

/** Non-reactive read of the current settings, for one-shot request bodies. */
export function getSettings(): Settings {
	return snapshot;
}

/**
 * The language a request asks answers in: the account choice, or the device's
 * language under "auto". Read at send time, for one-shot request bodies.
 */
export function getEffectiveAnswerLanguage(): BibleLanguage {
	return effectiveAnswerLanguage(snapshot.answerLanguage);
}

/** The theme the app should actually render, resolving "system" via the OS. */
export function useResolvedTheme(): ResolvedTheme {
	const themeMode = useSettingsSelector(selectThemeMode);
	const system = useColorScheme();
	if (themeMode === "system") return system === "light" ? "light" : "dark";
	return themeMode;
}

export interface Theme {
	mode: ThemeMode;
	resolved: ResolvedTheme;
	isDark: boolean;
	colors: Colors;
	meshGradient: readonly [string, string, string];
}

export function useTheme(): Theme {
	const themeMode = useSettingsSelector(selectThemeMode);
	const resolved = useResolvedTheme();
	return {
		mode: themeMode,
		resolved,
		isDark: resolved === "dark",
		colors: palettes[resolved],
		meshGradient: meshGradients[resolved],
	};
}

/**
 * Themed StyleSheet factory. Styles are created once per palette and cached,
 * so components declare their styles exactly as before but receive the active
 * palette:
 *
 *   const createStyles = (c: Colors) => StyleSheet.create({ label: { color: c.text } });
 *   const styles = useThemedStyles(createStyles);
 */
const styleCache = new WeakMap<(c: Colors) => unknown, WeakMap<Colors, unknown>>();

export function useThemedStyles<T>(factory: (c: Colors) => T): T {
	const { colors } = useTheme();
	let perFactory = styleCache.get(factory) as WeakMap<Colors, T> | undefined;
	if (!perFactory) {
		perFactory = new WeakMap();
		styleCache.set(factory, perFactory);
	}
	let styles = perFactory.get(colors);
	if (!styles) {
		styles = factory(colors);
		perFactory.set(colors, styles);
	}
	return styles;
}
