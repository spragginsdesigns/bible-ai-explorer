"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useClerk, useUser } from "@clerk/nextjs";
import {
	ArrowLeft,
	BookMarked,
	Brain,
	ChevronRight,
	Globe,
	LogOut,
	Monitor,
	Moon,
	Sun,
} from "lucide-react";
import { AndroidLogo, AppleLogo } from "@/components/icons/BrandIcons";
import {
	ANDROID_APK_URL,
	ANDROID_VERSION,
	MACOS_DMG_URL,
	MACOS_VERSION,
} from "@/lib/constants";
import { TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import {
	readParchmentPref,
	readTranslationPref,
	readMemoryEnabledPref,
	writeMemoryEnabledPref,
	readWebSearchEnabledPref,
} from "@/lib/preferences";
import {
	hydratePreferences,
	notifyPreferencesChanged,
	setParchmentPreference,
	setTranslationPreference,
	setWebSearchPreference,
	usePreference,
} from "@/lib/preferencesSync";
import { fetchMemories, setMemoryEnabled } from "@/lib/memories";
import MemoryManager from "@/components/MemoryManager";
import ProviderSettings from "@/components/ProviderSettings";
import ChurchSection from "@/components/settings/ChurchSection";

const THEME_OPTIONS = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "dark", label: "Dark", Icon: Moon },
	{ id: "light", label: "Light", Icon: Sun },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
			{children}
		</h2>
	);
}

/**
 * Settings: appearance (system/dark/light via next-themes), the default Bible
 * translation for the reader and verse attachments (mirrors the Android
 * settings screen), memory (enable toggle + manage dialog), and account
 * (profile + sign out).
 */
export default function SettingsPage() {
	const { theme, setTheme } = useTheme();
	const { user } = useUser();
	const { signOut } = useClerk();
	const [mounted, setMounted] = useState(false);
	// Every synced value is read from the shared cache rather than held here, so
	// a change made on another device (or in the reader) lands on this page as
	// soon as the account document is hydrated.
	const translation = usePreference<TranslationId>(readTranslationPref, "KJV");
	const parchmentEnabled = usePreference(readParchmentPref, true);
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
	}, []);

	const pickTranslation = (id: TranslationId) => {
		void setTranslationPreference(id);
	};

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
	const initial = (name || email || "✝").trim().charAt(0).toUpperCase();

	// No page-level min-h or background here: SettingsShell already wraps this
	// in the identical `min-h-[100dvh] gradient-mesh`, and stacking the two made
	// mobile Settings a full 56px taller than the viewport.
	return (
		<div>
			<div className="mx-auto w-full max-w-xl lg:max-w-5xl px-5 lg:px-8 pb-28 lg:pb-16">
				{/* Top bar */}
				{/* Mobile gets this bar from SettingsShell (with a hamburger);
				    desktop keeps the page title row. */}
				<div className="hidden lg:flex items-center gap-4 py-4 lg:py-6">
					<Link
						href="/"
						className="flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
						aria-label="Back"
					>
						<ArrowLeft className="w-5 h-5" />
					</Link>
					<h1 className="flex-1 text-center lg:text-left text-screen-title font-bold text-neutral-900 dark:text-neutral-100">
						Settings
					</h1>
					<span className="min-w-[44px]" aria-hidden />
				</div>

				{/* One column on phones; two balanced column stacks on desktop */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
					<div className="flex flex-col gap-6 min-w-0">
					{/* Appearance */}
					<section id="appearance" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>APPEARANCE</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
							<div className="grid grid-cols-3 gap-2">
								{THEME_OPTIONS.map(({ id, label, Icon }) => {
									const active = mounted && theme === id;
									return (
										<button
											key={id}
											type="button"
											aria-pressed={active}
											onClick={() => setTheme(id)}
											className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border text-[13px] font-bold transition-colors ${
												active
													? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
													: "border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
											}`}
										>
											<Icon className="w-3.5 h-3.5" />
											{label}
										</button>
									);
								})}
							</div>
							<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
								System follows your device&apos;s dark or light mode.
							</p>
							<div className="flex items-center justify-between gap-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
								<div>
									<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
										Parchment reader
									</p>
									<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
										Read the Bible on aged scroll paper. Off returns the plain reader.
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={parchmentEnabled}
									aria-label="Parchment reader"
									disabled={!mounted}
									onClick={() => void setParchmentPreference(!parchmentEnabled)}
									className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
										parchmentEnabled
											? "bg-amber-500 dark:bg-amber-400"
											: "bg-black/[0.15] dark:bg-white/[0.15]"
									}`}
								>
									<span
										className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
											parchmentEnabled ? "translate-x-[22px]" : "translate-x-0.5"
										}`}
									/>
								</button>
							</div>
						</div>
					</section>

					{/* Bible translation */}
					<section id="translation" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>BIBLE TRANSLATION</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
							<div className="grid grid-cols-2 gap-2">
								{(Object.keys(TRANSLATIONS) as TranslationId[]).map((id) => {
									const active = mounted && translation === id;
									return (
										<button
											key={id}
											type="button"
											aria-pressed={active}
											onClick={() => pickTranslation(id)}
											className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border text-[13px] font-bold transition-colors ${
												active
													? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
													: "border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
											}`}
										>
											<BookMarked className="w-3.5 h-3.5" />
											{id}
										</button>
									);
								})}
							</div>
							<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
								Used by the Bible reader and verse attachments. KJV works fully offline; NKJV
								is fetched when needed. SureWord&apos;s AI answers use the translation you select.
							</p>
						</div>
					</section>

					{/* Memory */}
					<section id="memory" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>MEMORY</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
							<div className="flex items-center gap-3">
								<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
									<Brain className="w-5 h-5" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
										Enable memory
									</p>
									<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
										When off, SureWord won&apos;t use or save memories. Your saved
										memories are kept.
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={memoryEnabled ?? false}
									aria-label="Enable memory"
									disabled={
										!mounted || memoryEnabled === null || memoryLoadFailed || memoryTogglePending
									}
									onClick={() => {
										if (memoryEnabled !== null) void toggleMemory(!memoryEnabled);
									}}
									className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
										memoryEnabled
											? "bg-amber-500 dark:bg-amber-400"
											: "bg-black/[0.15] dark:bg-white/[0.15]"
									}`}
								>
									<span
										className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
											memoryEnabled ? "translate-x-[22px]" : "translate-x-0.5"
										}`}
									/>
								</button>
							</div>
							{memoryToggleError && (
								<p className="text-xs text-red-600 dark:text-red-400">{memoryToggleError}</p>
							)}
							{memoryLoadFailed ? (
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs text-neutral-400 dark:text-neutral-500">
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
									className="flex min-h-[44px] items-center gap-3 rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3.5 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
								>
									<span className="min-w-0 flex-1 text-left">
										<span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
											Manage memories
										</span>
										<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
											{memoryCount === null ? "…" : `${memoryCount} saved`}
										</span>
									</span>
									<ChevronRight className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
								</button>
							)}
						</div>
					</section>

					{/* Web search */}
					<section id="web-search" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>WEB SEARCH</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
							<div className="flex items-center gap-3">
								<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
									<Globe className="w-5 h-5" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
										Enable web search
									</p>
									<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
										Lets SureWord look up supplementary material online (church
										history, archaeology, current events). Scripture stays the
										final authority.
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={webSearchEnabled ?? false}
									aria-label="Enable web search"
									disabled={
										!mounted || webSearchEnabled === null || webSearchLoadFailed || webSearchTogglePending
									}
									onClick={() => {
										if (webSearchEnabled !== null) void toggleWebSearch(!webSearchEnabled);
									}}
									className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
										webSearchEnabled
											? "bg-amber-500 dark:bg-amber-400"
											: "bg-black/[0.15] dark:bg-white/[0.15]"
									}`}
								>
									<span
										className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
											webSearchEnabled ? "translate-x-[22px]" : "translate-x-0.5"
										}`}
									/>
								</button>
							</div>
							{webSearchToggleError && (
								<p className="text-xs text-red-600 dark:text-red-400">{webSearchToggleError}</p>
							)}
							{webSearchLoadFailed && (
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs text-neutral-400 dark:text-neutral-500">
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
							)}
						</div>
					</section>

					{/* My church */}
					<ChurchSection />

					</div>

					<div className="flex flex-col gap-6 min-w-0">
					{/* AI providers */}
					<section id="providers" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>AI PROVIDERS</SectionLabel>
						<ProviderSettings />
					</section>

					{/* Account */}
					<section id="account" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>ACCOUNT</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-4">
							<div className="flex items-center gap-3">
								<span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-lg font-bold text-amber-600 dark:text-amber-400">
									{initial}
								</span>
								<div className="min-w-0 flex-1">
									{name && (
										<p className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
											{name}
										</p>
									)}
									<p className="truncate text-[13px] text-neutral-400 dark:text-neutral-500">
										{email || "Signed in"}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => void signOut({ redirectUrl: "/sign-in" })}
								className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-red-500/25 dark:border-red-400/20 bg-red-500/10 dark:bg-red-400/10 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-400/20 transition-colors"
							>
								<LogOut className="w-4 h-4" />
								Sign out
							</button>
						</div>
					</section>

					{/* Get the app */}
					<section id="get-the-app" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>GET THE APP</SectionLabel>
						<a
							href={ANDROID_APK_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="glass-card gradient-border rounded-2xl p-4 flex items-center gap-3 hover:border-amber-500/40 dark:hover:border-amber-400/30 transition-colors"
						>
							<span className="flex h-11 w-11 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
								<AndroidLogo className="w-5 h-5" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline gap-2">
									<span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
										SureWord for Android
									</span>
									<span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
										{ANDROID_VERSION}
									</span>
								</span>
								<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
									Offline KJV reading, tap a verse for an explanation, and your
									daily walk in Pick Up Your Cross.
								</span>
							</span>
						</a>
						<a
							href={MACOS_DMG_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="glass-card gradient-border rounded-2xl p-4 flex items-center gap-3 hover:border-amber-500/40 dark:hover:border-amber-400/30 transition-colors"
						>
							<span className="flex h-11 w-11 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
								<AppleLogo className="w-5 h-5" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline gap-2">
									<span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
										SureWord for macOS
									</span>
									<span className="text-metadata font-semibold text-amber-600/80 dark:text-amber-400/70">
										{MACOS_VERSION}
									</span>
								</span>
								<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
									Native Mac app (macOS 15+), now with tap-a-verse explanations
									and Pick Up Your Cross. The DMG is not notarized: on first launch,
									open System Settings → Privacy &amp; Security and choose Open Anyway.
								</span>
							</span>
						</a>
					</section>

					{/* About */}
					<section id="about" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
						<SectionLabel>ABOUT</SectionLabel>
						<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-2">
							<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
								SureWord
							</p>
							<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
								A Bible study assistant rooted in the King James Version.
							</p>
							<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
								Why it&apos;s different: ask a generic AI if the Bible is really the Word of God
								and you&apos;ll hear &ldquo;it depends on your viewpoint.&rdquo; SureWord never
								hedges — it answers as a Bible-believing Christian, standing on Scripture as the
								inerrant, infallible, final authority for every answer. &ldquo;All scripture is
								given by inspiration of God&rdquo; — 2 Timothy 3:16.
							</p>
						</div>
					</section>
					</div>
				</div>
			</div>

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
