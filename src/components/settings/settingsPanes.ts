"use client";

import { useCallback, useEffect, useState } from "react";
import {
	Bell,
	Brush,
	Church,
	Cpu,
	Info,
	MessageSquareText,
	Palette,
	Share2,
	Sparkles,
	UserRound,
	type LucideIcon,
} from "lucide-react";

/**
 * The Settings pages, in the order and groups of Android's settings hub
 * (`mobile/app/(app)/settings/index.tsx`) and the Mac's System Settings-style
 * sheet (`macos/SureWord/Settings/SettingsView.swift`, `SettingsPane`): the
 * account row on top, then Study, Assistant and App. Titles, summaries,
 * colours and search words match the Mac so a page is found the same way on
 * every client.
 */
export type SettingsPaneId =
	| "account"
	| "appearance"
	| "highlights"
	| "church"
	| "memory"
	| "ai"
	| "shared"
	| "notifications"
	| "feedback"
	| "about";

export type SettingsGroupId = "study" | "assistant" | "app";

export interface SettingsPane {
	id: SettingsPaneId;
	/** null for the account row, which sits above the groups. */
	group: SettingsGroupId | null;
	title: string;
	/** The line under the page title, saying what the page is for. */
	summary: string;
	Icon: LucideIcon;
	/** Tailwind gradient for the System Settings-style icon tile. */
	tile: string;
	/** Words a reader might search for that are on the page but not in its title. */
	keywords: string[];
}

export const SETTINGS_GROUPS: { id: SettingsGroupId; title: string }[] = [
	{ id: "study", title: "Study" },
	{ id: "assistant", title: "Assistant" },
	{ id: "app", title: "App" },
];

export const SETTINGS_PANES: SettingsPane[] = [
	{
		id: "account",
		group: null,
		title: "Account",
		summary: "Who is signed in, signing out, and deleting your account.",
		Icon: UserRound,
		tile: "from-neutral-400 to-neutral-500",
		keywords: ["sign out", "log out", "delete", "email", "profile"],
	},
	{
		id: "appearance",
		group: "study",
		title: "Appearance & reading",
		summary: "Theme, the parchment page, and your default Bible translation.",
		Icon: Palette,
		tile: "from-indigo-400 to-indigo-600",
		keywords: ["theme", "dark", "light", "parchment", "translation", "kjv", "nkjv", "bsb", "bible", "quiz"],
	},
	{
		id: "highlights",
		group: "study",
		title: "Highlight labels",
		summary: "Names and meanings for your highlight colours.",
		Icon: Brush,
		tile: "from-orange-400 to-orange-600",
		keywords: ["colour", "color", "highlight", "labels", "yellow", "meaning"],
	},
	{
		id: "church",
		group: "study",
		title: "My church",
		summary: "The congregation you belong to.",
		Icon: Church,
		tile: "from-amber-600 to-amber-800",
		keywords: ["church", "congregation", "mission"],
	},
	{
		id: "memory",
		group: "assistant",
		title: "Memory",
		summary: "What SureWord remembers about you, and what you've told it.",
		Icon: Sparkles,
		tile: "from-purple-400 to-purple-600",
		keywords: ["memories", "about me", "testimony", "personal", "remember"],
	},
	{
		id: "ai",
		group: "assistant",
		title: "AI",
		summary: "Your own AI keys, SureWord Pro, web search and data sharing.",
		Icon: Cpu,
		tile: "from-teal-400 to-teal-600",
		keywords: ["api key", "provider", "model", "openai", "anthropic", "pro", "membership", "subscription", "web search", "tavily", "consent", "privacy"],
	},
	{
		id: "shared",
		group: "assistant",
		title: "Shared answers",
		summary: "Public links to answers and verse cards you've sent.",
		Icon: Share2,
		tile: "from-sky-400 to-blue-600",
		keywords: ["links", "share", "cards", "revoke", "privacy"],
	},
	{
		id: "notifications",
		group: "app",
		title: "Notifications",
		summary: "The daily verse reminder and answer-ready notices.",
		Icon: Bell,
		tile: "from-rose-400 to-red-600",
		keywords: ["verse of the day", "reminder", "daily", "chat", "alert", "push"],
	},
	{
		id: "feedback",
		group: "app",
		title: "Send feedback",
		summary: "Tell us what is broken or missing.",
		Icon: MessageSquareText,
		tile: "from-emerald-400 to-green-600",
		keywords: ["bug", "report", "suggestion", "contact"],
	},
	{
		id: "about",
		group: "app",
		title: "About",
		summary: "Version, release notes, the apps, and why SureWord.",
		Icon: Info,
		tile: "from-neutral-400 to-neutral-500",
		keywords: ["version", "what's new", "release notes", "android", "mac", "macos", "download", "apk", "get the app"],
	},
];

const PANE_IDS = new Set<string>(SETTINGS_PANES.map((pane) => pane.id));

/**
 * The section anchors of the old single-page Settings, still in links that
 * other screens, receipts (`src/lib/chat/receipt-links.ts`) and bookmarks
 * hold, mapped to the page that now holds that section.
 */
const LEGACY_HASHES: Record<string, SettingsPaneId> = {
	translation: "appearance",
	"highlight-labels": "highlights",
	"about-me": "memory",
	testimony: "memory",
	"web-search": "ai",
	providers: "ai",
	"sent-cards": "shared",
	"get-the-app": "about",
};

export function paneById(id: SettingsPaneId): SettingsPane {
	return SETTINGS_PANES.find((pane) => pane.id === id) ?? SETTINGS_PANES[1];
}

/** The page a `#hash` names, or null for the bare hub. */
export function paneFromHash(hash: string): SettingsPaneId | null {
	const key = hash.replace(/^#/, "");
	if (PANE_IDS.has(key)) return key as SettingsPaneId;
	return LEGACY_HASHES[key] ?? null;
}

export function paneMatches(pane: SettingsPane, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return (
		pane.title.toLowerCase().includes(q) ||
		pane.summary.toLowerCase().includes(q) ||
		pane.keywords.some((word) => word.includes(q))
	);
}

/** Tailwind's `lg`, where the category list docks beside the page. */
const DESKTOP_QUERY = "(min-width: 1024px)";
const LAST_PANE_KEY = "settings.web.pane";

function readLastPane(): SettingsPaneId {
	try {
		const saved = window.localStorage.getItem(LAST_PANE_KEY);
		if (saved && PANE_IDS.has(saved)) return saved as SettingsPaneId;
	} catch {
		// Storage blocked: fall through to the first page.
	}
	return "appearance";
}

function writeLastPane(id: SettingsPaneId) {
	try {
		window.localStorage.setItem(LAST_PANE_KEY, id);
	} catch {
		// Remembering the page is a convenience only.
	}
}

/**
 * The open page lives in the URL hash, so the sidebar and the page agree
 * without shared state, back walks through visited pages, and every old
 * `/settings#section` link still lands somewhere real.
 */
export function useSettingsPane(): [SettingsPaneId | null, (id: SettingsPaneId | null) => void] {
	const [pane, setPane] = useState<SettingsPaneId | null>(null);

	useEffect(() => {
		const sync = () => {
			let next = paneFromHash(window.location.hash);
			// Phones open on the hub; a desktop has room for the page beside the
			// list, so it reopens where the reader left it, as the Mac does.
			if (next === null && window.matchMedia(DESKTOP_QUERY).matches) {
				next = readLastPane();
				history.replaceState(null, "", `#${next}`);
			}
			if (next !== null) writeLastPane(next);
			setPane(next);
		};
		sync();
		window.addEventListener("hashchange", sync);
		// A Next <Link> to `/settings#…` from this page changes the hash with
		// pushState, which fires no hashchange; the Navigation API sees it.
		const navigation = (window as Window & { navigation?: EventTarget }).navigation;
		navigation?.addEventListener("currententrychange", sync);
		return () => {
			window.removeEventListener("hashchange", sync);
			navigation?.removeEventListener("currententrychange", sync);
		};
	}, []);

	const open = useCallback((id: SettingsPaneId | null) => {
		if (id === null) {
			history.pushState(null, "", window.location.pathname + window.location.search);
			window.dispatchEvent(new HashChangeEvent("hashchange"));
			return;
		}
		window.location.hash = id;
	}, []);

	return [pane, open];
}
