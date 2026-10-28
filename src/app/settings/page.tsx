"use client";

import { trackNativeDownload } from "@/lib/analytics/client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useClerk, useUser } from "@clerk/nextjs";
import { Brain, Check, ChevronRight, Globe, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { AndroidLogo, AppleLogo } from "@/components/icons/BrandIcons";
import {
	ANDROID_APK_URL,
	ANDROID_VERSION,
	MACOS_DMG_URL,
	MACOS_VERSION,
	WEB_VERSION,
} from "@/lib/constants";
import { LANGUAGE_NAMES, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { ANSWER_LANGUAGE_PREFS, type AnswerLanguagePref } from "@/lib/preferences-contract";
import {
	readParchmentPref,
	readQuizOfferPref,
	writeQuizOfferPref,
	readTranslationPref,
	readAnswerLanguagePref,
	deviceAnswerLanguage,
	readMemoryEnabledPref,
	writeMemoryEnabledPref,
	readWebSearchEnabledPref,
} from "@/lib/preferences";
import {
	chooseAnswerLanguage,
	hydratePreferences,
	notifyPreferencesChanged,
	setParchmentPreference,
	setTranslationPreference,
	setWebSearchPreference,
	usePreference,
} from "@/lib/preferencesSync";
import { fetchMemories, setMemoryEnabled } from "@/lib/memories";
import MemoryManager from "@/components/MemoryManager";
import AboutMeSection from "@/components/settings/AboutMeSection";
import TestimonySection from "@/components/settings/TestimonySection";
import ChurchSection from "@/components/settings/ChurchSection";
import HighlightLabelsSection from "@/components/settings/HighlightLabelsSection";
import SharedAnswersSection from "@/components/settings/SharedAnswersSection";
import SentCardsSection from "@/components/settings/SentCardsSection";
import FeedbackSection from "@/components/settings/FeedbackSection";
import MembershipSummary from "@/components/settings/MembershipSummary";
import { AIConsentSettingsSection } from "@/components/AIConsentPresenter";
import NotificationsSection from "@/components/settings/NotificationsSection";
import DeleteAccountSection from "@/components/settings/DeleteAccountSection";
import TextSizeControl from "@/components/walk/TextSizeControl";
import WalkMeThroughButton from "@/components/walk/WalkMeThroughButton";
import { AccountAvatar, PaneTile } from "@/components/settings/SettingsSectionNav";
import { SETTINGS_CARD, SettingsGroup, SettingsRow, Switch } from "@/components/settings/SettingsPrimitives";
import {
	SETTINGS_GROUPS,
	SETTINGS_PANES,
	paneById,
	useSettingsPane,
	type SettingsPaneId,
} from "@/components/settings/settingsPanes";

const THEME_OPTIONS = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "light", label: "Light", Icon: Sun },
	{ id: "dark", label: "Dark", Icon: Moon },
] as const;

const TRANSLATION_DETAILS: Record<TranslationId, { badge: string; name: string; note: string }> = {
	KJV: { badge: "KJV", name: "King James Version", note: "Public domain · works offline" },
	BSB: { badge: "BSB", name: "Berean Standard Bible", note: "Public domain · works offline" },
	NKJV: { badge: "NKJV", name: "New King James Version", note: "© Thomas Nelson · fetched when needed" },
	ASV: { badge: "ASV", name: "American Standard Version", note: "Public domain · works offline" },
	RV1909: { badge: "RV", name: "Reina-Valera 1909 · Español", note: "Public domain · works offline" },
	LUT1912: { badge: "LUT", name: "Lutherbibel 1912 · Deutsch", note: "Public domain · works offline" },
};

const ICON_BUBBLE =
	"flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400";

/** A miniature window in the theme it names, so the choice is seen, not read. */
function ThemePreview({ id }: { id: (typeof THEME_OPTIONS)[number]["id"] }) {
	const half = (dark: boolean) => (
		<div className={`flex h-full flex-1 flex-col gap-1 p-1.5 ${dark ? "bg-neutral-900" : "bg-[#f7f3ea]"}`}>
			<div className={`h-1.5 w-2/3 rounded-full ${dark ? "bg-amber-400/80" : "bg-amber-600/80"}`} />
			<div className={`h-1 w-full rounded-full ${dark ? "bg-white/20" : "bg-black/15"}`} />
			<div className={`h-1 w-5/6 rounded-full ${dark ? "bg-white/20" : "bg-black/15"}`} />
			<div className={`mt-auto h-2.5 w-full rounded ${dark ? "bg-white/10" : "bg-black/[0.06]"}`} />
		</div>
	);
	return (
		<div className="flex h-14 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
			{id === "light" ? half(false) : id === "dark" ? half(true) : (
				<>
					{half(false)}
					{half(true)}
				</>
			)}
		</div>
	);
}

/**
 * Settings, organised the way the apps are: on a phone a hub of categories
 * (Android's settings hub), each opening its own page; on a desktop the
 * sidebar lists the categories (as the Mac's Settings does) and one page sits
 * beside it. The open page is the URL hash, so every old `/settings#section`
 * link still lands on the page that holds that section.
 */
export default function SettingsPage() {
	const { theme, setTheme } = useTheme();
	const { user, isLoaded: userLoaded } = useUser();
	const { signOut } = useClerk();
	const [pane, openPane] = useSettingsPane();
	const [mounted, setMounted] = useState(false);
	const [confirmSignOut, setConfirmSignOut] = useState(false);
	// Every synced value is read from the shared cache rather than held here, so
	// a change made on another device (or in the reader) lands on this page as
	// soon as the account document is hydrated.
	const translation = usePreference<TranslationId>(readTranslationPref, "KJV");
	const parchmentEnabled = usePreference(readParchmentPref, true);
	const answerLanguage = usePreference<AnswerLanguagePref>(readAnswerLanguagePref, "auto");
	// Device-only (never synced): whether the reader offers a quiz at a chapter's end.
	const quizOfferEnabled = usePreference(readQuizOfferPref, true);
	const memoryEnabled = usePreference(readMemoryEnabledPref, null);
	const webSearchEnabled = usePreference(readWebSearchEnabledPref, null);
	const [memoryCount, setMemoryCount] = useState<number | null>(null);
	const [memoryLoadFailed, setMemoryLoadFailed] = useState(false);
	const [memoryTogglePending, setMemoryTogglePending] = useState(false);
	const [memoryToggleError, setMemoryToggleError] = useState<string | null>(null);
	const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);
	const [webSearchLoadFailed, setWebSearchLoadFailed] = useState(false);
	const [webSearchTogglePending, setWebSearchTogglePending] = useState(false);
	const [webSearchToggleError, setWebSearchToggleError] = useState<string | null>(null);

	const loadMemories = async () => {
		setMemoryLoadFailed(false);
		try {
			const data = await fetchMemories();
			// This route carries the memory switch as well as the list, so its
			// answer updates the shared cache the toggle reads.
			writeMemoryEnabledPref(data.enabled);
			notifyPreferencesChanged();
			setMemoryCount(data.memories.length);
			setMemoryLoadFailed(false);
		} catch {
			setMemoryLoadFailed(true);
		}
	};

	// The whole account document, not just this toggle: one GET brings the
	// translation, parchment, listen speed and chat picks up to date too.
	const loadPreferences = async () => {
		setWebSearchLoadFailed(false);
		const ok = await hydratePreferences({ force: true });
		if (!ok) setWebSearchLoadFailed(true);
	};

	useEffect(() => {
		setMounted(true);
		void loadMemories();
		void loadPreferences();
		// A memory receipt (or any deep link) to /settings#memory lands on the
		// list itself, the way Android goes straight to its Memories screen.
		// Only on arrival: picking Memory in the sidebar just opens the page.
		if (window.location.hash === "#memory") setMemoryManagerOpen(true);
	}, []);

	// Each page starts at its top. The browser would otherwise scroll to the
	// section element whose id matches the hash, hiding the page header.
	useEffect(() => {
		window.scrollTo({ top: 0 });
		setConfirmSignOut(false);
	}, [pane]);

	// Optimistic toggle; reverts and surfaces the server error on failure.
	const toggleMemory = async (next: boolean) => {
		if (memoryTogglePending) return;
		const previous = memoryEnabled;
		writeMemoryEnabledPref(next);
		notifyPreferencesChanged();
		setMemoryTogglePending(true);
		setMemoryToggleError(null);
		try {
			await setMemoryEnabled(next);
		} catch (err) {
			writeMemoryEnabledPref(previous ?? !next);
			notifyPreferencesChanged();
			setMemoryToggleError(
				err instanceof Error ? err.message : "Couldn't update memory settings."
			);
		} finally {
			setMemoryTogglePending(false);
		}
	};

	// Same optimistic pattern, run by the shared write-through pipe. Silent
	// because this row already renders the failure under the toggle.
	const toggleWebSearch = async (next: boolean) => {
		if (webSearchTogglePending) return;
		setWebSearchTogglePending(true);
		setWebSearchToggleError(null);
		const error = await setWebSearchPreference(next, { silent: true });
		if (error) setWebSearchToggleError(error);
		setWebSearchTogglePending(false);
	};

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";

	// The hub rows answer the common question ("is memory on?") without a tap,
	// as Android's hub does.
	const themeLabel = mounted
		? (THEME_OPTIONS.find((option) => option.id === theme)?.label ?? "System")
		: "…";
	const memorySubtitle =
		memoryEnabled === null
			? "…"
			: memoryEnabled
				? memoryCount === null
					? "On"
					: `On · ${memoryCount} saved`
				: "Off";
	const hubSubtitles: Partial<Record<SettingsPaneId, string>> = {
		appearance: [
			themeLabel,
			parchmentEnabled ? "Parchment" : "Plain reader",
			translation,
			...(mounted && answerLanguage !== "auto" ? [LANGUAGE_NAMES[answerLanguage]] : []),
		].join(" · "),
		highlights: "Names and meanings for your colours",
		church: "The congregation you belong to",
		memory: memorySubtitle,
		ai:
			webSearchEnabled === null
				? "Membership, web search"
				: `Membership · web search ${webSearchEnabled ? "on" : "off"}`,
		shared: "Links you have shared",
		notifications: "Daily verse and answer-ready notices",
		feedback: "Tell us what is broken or missing",
		about: `Version ${WEB_VERSION}`,
	};

	const getTheApp = (
		<SettingsGroup label="Get the app">
			<a
				href={ANDROID_APK_URL}
				onClick={() => trackNativeDownload("android", "settings")}
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center gap-3 px-4 py-3.5 transition-colors first:rounded-t-2xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
			>
				<span className={ICON_BUBBLE}>
					<AndroidLogo className="w-5 h-5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
							SureWord for Android
						</span>
						<span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
							{ANDROID_VERSION}
						</span>
					</span>
					<span className="block text-[0.8125rem] leading-[1.125rem] text-neutral-500 dark:text-neutral-400">
						Offline KJV reading, tap a verse for an explanation, and your
						daily walk in Pick Up Your Cross.
					</span>
				</span>
				<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
			</a>
			<a
				href={MACOS_DMG_URL}
				onClick={() => trackNativeDownload("macos", "settings")}
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center gap-3 px-4 py-3.5 transition-colors last:rounded-b-2xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
			>
				<span className={ICON_BUBBLE}>
					<AppleLogo className="w-5 h-5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
							SureWord for macOS
						</span>
						<span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
							{MACOS_VERSION}
						</span>
					</span>
					<span className="block text-[0.8125rem] leading-[1.125rem] text-neutral-500 dark:text-neutral-400">
						Native Mac app (macOS 15+), now with tap-a-verse explanations
						and Pick Up Your Cross. The DMG is not notarized: on first launch,
						open System Settings → Privacy &amp; Security and choose Open Anyway.
					</span>
				</span>
				<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
			</a>
		</SettingsGroup>
	);

	const renderPane = (id: SettingsPaneId) => {
		switch (id) {
			case "account":
				return (
					<>
						<div className={`${SETTINGS_CARD} flex items-center gap-4 p-5`}>
							<AccountAvatar size={56} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-lg font-bold text-neutral-900 dark:text-neutral-100">
									{name || "Signed in"}
								</p>
								<p className="truncate text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
									{email || "SureWord account"}
								</p>
							</div>
						</div>
						<SettingsGroup label="Session">
							<div className="flex flex-col gap-3 p-4">
								{confirmSignOut ? (
									<>
										<p className="text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
											Sign out? You can sign back in at any time.
										</p>
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => setConfirmSignOut(false)}
												className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-black/[0.1] dark:border-white/[0.08] text-sm font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
											>
												Cancel
											</button>
											<button
												type="button"
												onClick={() => void signOut({ redirectUrl: "/sign-in" })}
												className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/25 dark:border-red-400/20 bg-red-500/10 dark:bg-red-400/10 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-400/20 transition-colors"
											>
												<LogOut className="w-4 h-4" />
												Sign out
											</button>
										</div>
									</>
								) : (
									<button
										type="button"
										onClick={() => setConfirmSignOut(true)}
										className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-red-500/25 dark:border-red-400/20 bg-red-500/10 dark:bg-red-400/10 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-400/20 transition-colors"
									>
										<LogOut className="w-4 h-4" />
										Sign out
									</button>
								)}
							</div>
						</SettingsGroup>
						<SettingsGroup label="Danger zone">
							<div className="p-4">
								<DeleteAccountSection />
							</div>
						</SettingsGroup>
					</>
				);

			case "appearance":
				return (
					<>
						<SettingsGroup
							label="Theme"
							footer="System follows your device's dark or light mode."
						>
							<div className="grid grid-cols-3 gap-2.5 p-3 sm:gap-3 sm:p-4">
								{THEME_OPTIONS.map(({ id, label, Icon }) => {
									const active = mounted && theme === id;
									return (
										<button
											key={id}
											type="button"
											aria-pressed={active}
											onClick={() => setTheme(id)}
											className={`flex flex-col gap-2 rounded-xl border p-2 text-[0.8125rem] font-bold transition-colors ${
												active
													? "border-amber-500/60 dark:border-amber-400/50 bg-amber-500/10 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500/20"
													: "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-neutral-600 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
											}`}
										>
											<ThemePreview id={id} />
											<span className="flex items-center justify-center gap-1.5 pb-0.5">
												<Icon className="w-3.5 h-3.5" />
												{label}
											</span>
										</button>
									);
								})}
							</div>
						</SettingsGroup>

						<SettingsGroup label="Text size">
							<TextSizeControl mounted={mounted} />
						</SettingsGroup>

						<SettingsGroup label="Reading">
							<SettingsRow
								title="Parchment reader"
								description="Read the Bible on aged scroll paper. Off returns the plain reader."
								control={
									<Switch
										checked={parchmentEnabled}
										label="Parchment reader"
										disabled={!mounted}
										onChange={(next) => void setParchmentPreference(next)}
									/>
								}
							/>
							<SettingsRow
								title="Offer a quiz after each chapter"
								description="A short, optional quiz at the end of each chapter. Every answer comes with its verse."
								control={
									<Switch
										checked={quizOfferEnabled}
										label="Offer a quiz after each chapter"
										disabled={!mounted}
										onChange={(next) => {
											writeQuizOfferPref(next);
											notifyPreferencesChanged();
										}}
									/>
								}
							/>
						</SettingsGroup>

						<SettingsGroup
							label="Language"
							footer="Answers are written in this language and quote its Bible: the KJV in English, the Reina-Valera 1909 in Español, the Lutherbibel 1912 in Deutsch. Choosing a language also opens its Bible in the reader. Saved to your account."
						>
							{ANSWER_LANGUAGE_PREFS.map((choice) => {
								const active = mounted && answerLanguage === choice;
								const label =
									choice === "auto"
										? `Follow my device${mounted ? ` (${LANGUAGE_NAMES[deviceAnswerLanguage()]})` : ""}`
										: LANGUAGE_NAMES[choice];
								return (
									<button
										key={choice}
										type="button"
										aria-pressed={active}
										onClick={() => void chooseAnswerLanguage(choice)}
										className="flex min-h-[48px] items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
									>
										<span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
											{label}
										</span>
										{active ? (
											<Check className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
										) : null}
									</button>
								);
							})}
						</SettingsGroup>

						<SettingsGroup
							label="Bible translation"
							footer="Used by the Bible reader and verse attachments. Every translation but NKJV works offline. SureWord's AI answers quote the translation you select when it is in the language they are written in."
						>
							{(Object.keys(TRANSLATIONS) as TranslationId[]).map((id) => {
								const active = mounted && translation === id;
								return (
									<button
										key={id}
										type="button"
										aria-pressed={active}
										onClick={() => void setTranslationPreference(id)}
										className="flex min-h-[56px] items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
									>
										<span
											className={`flex h-10 w-12 flex-shrink-0 items-center justify-center rounded-lg border text-[0.8125rem] font-extrabold tracking-wider ${
												active
													? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300"
													: "border-black/[0.08] bg-black/[0.03] text-neutral-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-400"
											}`}
										>
											{TRANSLATION_DETAILS[id].badge}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
												{TRANSLATION_DETAILS[id].name}
											</span>
											<span className="block text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
												{TRANSLATION_DETAILS[id].note}
											</span>
										</span>
										{active ? (
											<Check className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
										) : null}
									</button>
								);
							})}
						</SettingsGroup>
					</>
				);

			case "highlights":
				// Keyed by account so a new sign-in never inherits the previous
				// draft, but only once Clerk has loaded: keying on a value that
				// flips during the first client render remounted the section and
				// left the first copy in the DOM. Same for the other keyed sections.
				return userLoaded ? <HighlightLabelsSection key={user?.id ?? "signed-out"} /> : null;

			case "church":
				// Ways to Serve sits with My church: its church ways and "I already
				// give to my church" both read the church saved here.
				return (
					<>
						<ChurchSection />
						<SettingsGroup>
							<Link
								href="/serve"
								className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl px-4 text-[15px] font-semibold text-neutral-900 transition-colors hover:bg-black/[0.03] dark:text-neutral-100 dark:hover:bg-white/[0.03]"
							>
								Ways to Serve
								<ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" aria-hidden />
							</Link>
						</SettingsGroup>
					</>
				);

			case "memory":
				return (
					<>
						<SettingsGroup label="Memory">
							<SettingsRow
								icon={
									<span className={ICON_BUBBLE}>
										<Brain className="w-5 h-5" />
									</span>
								}
								title="Enable memory"
								description="When off, SureWord won't use or save memories. Your saved memories are kept."
								control={
									<Switch
										checked={memoryEnabled ?? false}
										label="Enable memory"
										disabled={
											!mounted || memoryEnabled === null || memoryLoadFailed || memoryTogglePending
										}
										onChange={(next) => {
											if (memoryEnabled !== null) void toggleMemory(next);
										}}
									/>
								}
							>
								{memoryToggleError ? (
									<p className="text-xs text-red-600 dark:text-red-400">{memoryToggleError}</p>
								) : null}
							</SettingsRow>
							{memoryLoadFailed ? (
								<div className="flex items-center justify-between gap-3 px-4 py-3.5">
									<p className="text-xs text-neutral-500 dark:text-neutral-400">
										Couldn&apos;t load memory settings.
									</p>
									<button
										type="button"
										onClick={() => void loadMemories()}
										className="text-xs font-bold text-amber-600 dark:text-amber-400"
									>
										Retry
									</button>
								</div>
							) : (
								<button
									type="button"
									onClick={() => setMemoryManagerOpen(true)}
									className="flex min-h-[56px] items-center gap-3 rounded-b-2xl px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
								>
									<span className="min-w-0 flex-1">
										<span className="block text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
											Manage memories
										</span>
										<span className="block text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
											{memoryCount === null ? "…" : `${memoryCount} saved`}
										</span>
									</span>
									<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
								</button>
							)}
						</SettingsGroup>
						{/* About me and the testimony sit with Memory because all three
						    are what the assistant knows about this person before a
						    conversation starts. */}
						{userLoaded ? <AboutMeSection key={user?.id ?? "signed-out"} /> : null}
						{userLoaded ? <TestimonySection key={user?.id ?? "signed-out"} /> : null}
					</>
				);

			case "ai":
				return (
					<>
						<section className="flex flex-col gap-2">
							<h2 className="px-1 text-metadata font-bold uppercase tracking-[0.15em] text-neutral-500">
								Membership
							</h2>
							<MembershipSummary />
						</section>
						<SettingsGroup label="Web search">
							<SettingsRow
								icon={
									<span className={ICON_BUBBLE}>
										<Globe className="w-5 h-5" />
									</span>
								}
								title="Enable web search"
								description="Lets SureWord look up supplementary material online (church history, archaeology, current events). Scripture stays the final authority."
								control={
									<Switch
										checked={webSearchEnabled ?? false}
										label="Enable web search"
										disabled={
											!mounted || webSearchEnabled === null || webSearchLoadFailed || webSearchTogglePending
										}
										onChange={(next) => {
											if (webSearchEnabled !== null) void toggleWebSearch(next);
										}}
									/>
								}
							>
								{webSearchToggleError ? (
									<p className="text-xs text-red-600 dark:text-red-400">{webSearchToggleError}</p>
								) : null}
								{webSearchLoadFailed ? (
									<div className="flex items-center justify-between gap-3">
										<p className="text-xs text-neutral-500 dark:text-neutral-400">
											Couldn&apos;t load web search settings.
										</p>
										<button
											type="button"
											onClick={() => void loadPreferences()}
											className="text-xs font-bold text-amber-600 dark:text-amber-400"
										>
											Retry
										</button>
									</div>
								) : null}
							</SettingsRow>
						</SettingsGroup>
						<section className="flex flex-col gap-2">
							<h2 className="px-1 text-metadata font-bold uppercase tracking-[0.15em] text-neutral-500">
								Data sharing
							</h2>
							<AIConsentSettingsSection />
						</section>
					</>
				);

			case "shared":
				return userLoaded ? (
					<>
						<SharedAnswersSection key={user?.id ?? "signed-out"} />
						<SentCardsSection key={`sent-${user?.id ?? "signed-out"}`} />
					</>
				) : null;

			case "notifications":
				return <NotificationsSection />;

			case "feedback":
				return <FeedbackSection />;

			case "about":
				return (
					<>
						<div className={`${SETTINGS_CARD} flex flex-col items-center gap-2 px-6 py-7 text-center`}>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src="/favicon-96x96.png" alt="" width={64} height={64} className="sidebar-brand-icon" />
							<p className="text-[1.625rem] leading-none text-amber-600 dark:text-amber-300 font-[family-name:var(--font-pirata)]">
								SureWord
							</p>
							<p className="text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
								Version {WEB_VERSION} · A Bible study assistant rooted in the King James Version.
							</p>
						</div>
						<SettingsGroup>
							<Link
								href="/whats-new"
								className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl px-4 text-[0.9375rem] font-semibold text-neutral-900 transition-colors hover:bg-black/[0.03] dark:text-neutral-100 dark:hover:bg-white/[0.03]"
							>
								What&apos;s new in SureWord
								<ChevronRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" aria-hidden />
							</Link>
							<WalkMeThroughButton />
						</SettingsGroup>
						{getTheApp}
						<SettingsGroup label="Why SureWord">
							<div className="flex flex-col gap-3 p-4">
								<p className="text-[0.8125rem] leading-[1.25rem] text-neutral-600 dark:text-neutral-300">
									Ask a generic AI if the Bible is really the Word of God and you&apos;ll hear
									&ldquo;it depends on your viewpoint.&rdquo; SureWord never hedges - it answers
									as a Bible-believing Christian, standing on Scripture as the inerrant,
									infallible, final authority for every answer.
								</p>
								<blockquote className="border-l-2 border-amber-500/50 pl-3 text-[0.8125rem] italic text-amber-700 dark:text-amber-300">
									&ldquo;All scripture is given by inspiration of God&rdquo; - 2 Timothy 3:16
								</blockquote>
							</div>
						</SettingsGroup>
					</>
				);
		}
	};

	const current = pane ? paneById(pane) : null;

	// No page-level min-h or background here: SettingsShell already wraps this
	// in `min-h-[100dvh] gradient-mesh`.
	return (
		<div>
			{current ? (
				<div key={current.id} className="mx-auto w-full max-w-2xl px-5 pb-28 pt-5 lg:px-8 lg:pb-16 lg:pt-10 animate-in fade-in duration-200">
					<header className="mb-6 flex items-center gap-4 lg:mb-8">
						{current.id === "account" ? <AccountAvatar size={44} /> : <PaneTile pane={current} size="lg" />}
						<div className="min-w-0">
							<h1 className="text-screen-title font-bold text-neutral-900 dark:text-neutral-100">
								{current.title}
							</h1>
							<p className="text-[0.8125rem] text-neutral-500 dark:text-neutral-400">{current.summary}</p>
						</div>
					</header>
					<div className="flex flex-col gap-6">{renderPane(current.id)}</div>
				</div>
			) : (
				// The hub: phones only. A desktop always has a page open (the
				// hook restores the last one), so this never paints there.
				<div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pb-28 pt-5 lg:hidden">
					<button
						type="button"
						onClick={() => openPane("account")}
						className={`${SETTINGS_CARD} flex items-center gap-3.5 p-4 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]`}
					>
						<AccountAvatar size={48} />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[1rem] font-bold text-neutral-900 dark:text-neutral-100">
								{name || "Signed in"}
							</span>
							<span className="block truncate text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
								{email || "SureWord account"}
							</span>
						</span>
						<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
					</button>

					{SETTINGS_GROUPS.map((group) => (
						<SettingsGroup key={group.id} label={group.title}>
							{SETTINGS_PANES.filter((item) => item.group === group.id).map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => openPane(item.id)}
									className="flex min-h-[60px] items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-black/[0.03] active:bg-black/[0.05] dark:hover:bg-white/[0.03] dark:active:bg-white/[0.05]"
								>
									<PaneTile pane={item} size="md" />
									<span className="min-w-0 flex-1">
										<span className="block text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">
											{item.title}
										</span>
										<span className="block truncate text-[0.8125rem] text-neutral-500 dark:text-neutral-400">
											{hubSubtitles[item.id]}
										</span>
									</span>
									<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
								</button>
							))}
						</SettingsGroup>
					))}

					{getTheApp}
				</div>
			)}

			{memoryManagerOpen && (
				<MemoryManager
					open={memoryManagerOpen}
					onMemoryCountChange={setMemoryCount}
					onClose={() => {
						setMemoryManagerOpen(false);
						void loadMemories();
					}}
				/>
			)}
		</div>
	);
}
