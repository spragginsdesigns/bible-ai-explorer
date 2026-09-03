import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { meshGradients, palettes, type Colors, type ResolvedTheme } from "@/theme";
import type { TranslationId } from "@/features/bible/translations";
import { DEFAULT_LISTEN_RATE, normalizeListenRate } from "@/features/cross/listen";

/**
 * Persisted user settings (appearance + Bible translation), modeled on
 * notesStore: a module-level snapshot exposed through useSyncExternalStore,
 * hydrated from / persisted to AsyncStorage. Everything visual in the app
 * reads its palette through the hooks here so a theme change re-renders
 * the whole tree with the new colors.
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
	/**
	 * Playback speed for the Listen devotional. Per-device, like every other
	 * setting here - a speed someone picked on their phone is a habit, not an
	 * account-level preference worth a round trip.
	 */
	listenRate: number;
}

const STORAGE_KEY = "sureword.settings.v1";

const DEFAULT_SETTINGS: Settings = {
	themeMode: "system",
	translation: "KJV",
	parchment: true,
	chatModelId: null,
	chatEffort: null,
	chatSpeed: null,
	chatVerbosity: null,
	chatMode: null,
	listenRate: DEFAULT_LISTEN_RATE,
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

export function setThemeMode(themeMode: ThemeMode) {
	setSnapshot({ ...snapshot, themeMode });
}

export function setBibleTranslation(translation: TranslationId) {
	setSnapshot({ ...snapshot, translation });
}

export function setParchmentEnabled(parchment: boolean) {
	setSnapshot({ ...snapshot, parchment });
}

export function setChatModel(chatModelId: string | null) {
	setSnapshot({ ...snapshot, chatModelId });
}

export function setChatEffort(chatEffort: string | null) {
	setSnapshot({ ...snapshot, chatEffort });
}

export function setChatSpeed(chatSpeed: string | null) {
	setSnapshot({ ...snapshot, chatSpeed });
}

export function setChatVerbosity(chatVerbosity: string | null) {
	setSnapshot({ ...snapshot, chatVerbosity });
}

export function setChatMode(chatMode: string | null) {
	setSnapshot({ ...snapshot, chatMode });
}

export function setListenRate(listenRate: number) {
	setSnapshot({ ...snapshot, listenRate: normalizeListenRate(listenRate) });
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
