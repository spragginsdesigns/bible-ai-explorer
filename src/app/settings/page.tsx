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
	LogOut,
	Monitor,
	Moon,
	Laptop,
	Smartphone,
	Sun,
} from "lucide-react";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import { TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";
import { readTranslationPref, writeTranslationPref } from "@/lib/preferences";
import { fetchMemories, setMemoryEnabled } from "@/lib/memories";
import MemoryManager from "@/components/MemoryManager";

const THEME_OPTIONS = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "dark", label: "Dark", Icon: Moon },
	{ id: "light", label: "Light", Icon: Sun },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<h2 className="text-[11px] font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
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
	const [translation, setTranslation] = useState<TranslationId>("KJV");
	const [memoryEnabled, setMemoryEnabledState] = useState<boolean | null>(null);
	const [memoryCount, setMemoryCount] = useState<number | null>(null);
	const [memoryLoadFailed, setMemoryLoadFailed] = useState(false);
	const [memoryTogglePending, setMemoryTogglePending] = useState(false);
	const [memoryToggleError, setMemoryToggleError] = useState<string | null>(null);
	const [memoryManagerOpen, setMemoryManagerOpen] = useState(false);

	const loadMemories = async () => {
		setMemoryLoadFailed(false);
		try {
			const data = await fetchMemories();
			setMemoryEnabledState(data.enabled);
			setMemoryCount(data.memories.length);
			setMemoryLoadFailed(false);
		} catch {
			setMemoryLoadFailed(true);
		}
	};

	useEffect(() => {
		setMounted(true);
		setTranslation(readTranslationPref());
		void loadMemories();
	}, []);

	const pickTranslation = (id: TranslationId) => {
		setTranslation(id);
		writeTranslationPref(id);
	};

	// Optimistic toggle; reverts and surfaces the server error on failure.
	const toggleMemory = async (next: boolean) => {
		if (memoryTogglePending) return;
		setMemoryEnabledState(next);
		setMemoryTogglePending(true);
		setMemoryToggleError(null);
		try {
			await setMemoryEnabled(next);
		} catch (err) {
			setMemoryEnabledState(!next);
			setMemoryToggleError(
				err instanceof Error ? err.message : "Couldn't update memory settings."
			);
		} finally {
			setMemoryTogglePending(false);
		}
	};

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";
	const initial = (name || email || "✝").trim().charAt(0).toUpperCase();

	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto w-full max-w-xl px-5 pb-28 lg:pb-16">
				{/* Top bar */}
				<div className="flex items-center gap-4 py-4">
					<Link
						href="/"
						className="flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
						aria-label="Back"
					>
						<ArrowLeft className="w-5 h-5" />
					</Link>
					<h1 className="flex-1 text-center text-[17px] font-bold text-neutral-900 dark:text-neutral-100">
						Settings
					</h1>
					<span className="min-w-[44px]" aria-hidden />
				</div>

				<div className="flex flex-col gap-6">
					{/* Appearance */}
					<section className="flex flex-col gap-2">
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
						</div>
					</section>

					{/* Bible translation */}
					<section className="flex flex-col gap-2">
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
								is streamed from bolls.life. SureWord&apos;s AI answers always quote the KJV.
							</p>
						</div>
					</section>

					{/* Memory */}
					<section className="flex flex-col gap-2">
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
										className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
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

					{/* Account */}
					<section className="flex flex-col gap-2">
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
					<section className="flex flex-col gap-2">
						<SectionLabel>GET THE APP</SectionLabel>
						<a
							href={ANDROID_APK_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="glass-card gradient-border rounded-2xl p-4 flex items-center gap-3 hover:border-amber-500/40 dark:hover:border-amber-400/30 transition-colors"
						>
							<span className="flex h-11 w-11 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
								<Smartphone className="w-5 h-5" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
									SureWord for Android
								</span>
								<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
									Install the native app with offline KJV reading.
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
								<Laptop className="w-5 h-5" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
									SureWord for macOS
								</span>
								<span className="block text-[13px] text-neutral-400 dark:text-neutral-500">
									Native Mac app (macOS 15+). First launch: right-click → Open.
								</span>
							</span>
						</a>
					</section>

					{/* About */}
					<section className="flex flex-col gap-2">
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
