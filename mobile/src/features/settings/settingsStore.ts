import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { meshGradients, palettes, type Colors, type ResolvedTheme } from "@/theme";
import type { TranslationId } from "@/features/bible/translations";
import { DEFAULT_LISTEN_RATE, normalizeListenRate } from "@/features/cross/listen";
import {
	DEFAULT_SYNCED_SETTINGS,
	settingsFromDocument,
	type PreferencesDocument,
	type PreferencesPatch,
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
}

const STORAGE_KEY = "sureword.settings.v1";

// The synced half comes from the contract module, so the first-adopt seed and
// this store can never disagree about what "never chosen" looks like.
const DEFAULT_SETTINGS: Settings = {
	themeMode: "system",
	...DEFAULT_SYNCED_SETTINGS,
};

let snapshot: Settings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function setSnapshot(next: Settings) {
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
			translation: parsed.translation === "NKJV" ? "NKJV" : "KJV",
			parchment: parsed.parchment !== false,
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
 * account. `themeMode` survives: it is a device setting, and flipping the app
 * to dark mid-session on a user switch would be startling and wrong.
 */
export function resetSyncedSettings() {
	setSnapshot({ ...DEFAULT_SETTINGS, themeMode: snapshot.themeMode });
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

/** Non-reactive read of the current settings, for one-shot request bodies. */
export function getSettings(): Settings {
	return snapshot;
}

/** The theme the app should actually render, resolving "system" via the OS. */
export function useResolvedTheme(): ResolvedTheme {
	const { themeMode } = useSettings();
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
	const { themeMode } = useSettings();
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
