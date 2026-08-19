"use client";

import React from "react";
import Image from "next/image";
import { AndroidLogo, AppleLogo } from "./icons/BrandIcons";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import {
	ANDROID_APK_URL,
	ANDROID_VERSION,
	MACOS_DMG_URL,
	MACOS_VERSION,
} from "@/lib/constants";

interface WelcomeScreenProps {
	onSelectQuestion: (question: string) => void;
}

/** Chip-shaped placeholders while this user's own questions are being drawn. */
const SKELETON_WIDTHS = [82, 68, 90, 74, 61, 86];

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onSelectQuestion }) => {
	const { questions, loading } = useSuggestedQuestions();

	return (
		<div className="flex-1 flex items-center justify-center">
			<div className="max-w-2xl mx-auto px-4 text-center">
				<div className="mb-6">
					<div className="w-20 h-20 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center mx-auto mb-5 animate-pulse-glow overflow-hidden">
						<Image
							src="/web-app-manifest-512x512.png"
							alt="SureWord"
							width={80}
							height={80}
							priority
							className="w-full h-full object-cover scale-110"
						/>
					</div>
					<h1 className="text-5xl sm:text-7xl font-bold text-neutral-900 dark:text-white mb-3 font-[family-name:var(--font-pirata)]">
						<span className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 dark:from-amber-300 dark:via-amber-400 dark:to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(200,160,40,0.3)]">SureWord</span>
					</h1>
					<p className="text-neutral-500 text-sm max-w-md mx-auto">
						Ask anything about the Bible — answered by an AI that actually believes it. Every answer stands on Scripture as God&apos;s inerrant, infallible, final authority.
					</p>
				</div>

				<div
					className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8"
					aria-busy={loading}
					aria-label={loading ? "Preparing your questions" : "Suggested questions"}
				>
					{loading
						? SKELETON_WIDTHS.map((width, i) => (
								<div
									key={i}
									className="px-4 py-3 rounded-xl gradient-border glass-card"
									aria-hidden
								>
									<div
										className="h-4 animate-pulse rounded-full bg-amber-500/15 dark:bg-amber-400/15"
										style={{ width: `${width}%`, animationDelay: `${i * 120}ms` }}
									/>
								</div>
							))
						: questions.map((q, i) => (
								<button
									key={i}
									onClick={() => onSelectQuestion(q)}
									className="text-left px-4 py-3 rounded-xl gradient-border glass-card text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-all duration-200 text-sm group animate-message-in"
								>
									<span className="group-hover:text-neutral-900 dark:group-hover:text-neutral-200 transition-colors">{q}</span>
								</button>
							))}
				</div>

				<div className="mt-8">
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
						✦ SureWord is also a native app — same account, same chats.
					</p>
					<div className="flex flex-col sm:flex-row items-center justify-center gap-3">
						<a
							href={ANDROID_APK_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex w-56 items-center gap-3 rounded-xl gradient-border glass-card px-4 py-2.5 text-left transition-all duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-amber-500/40 dark:hover:border-amber-400/30"
						>
							<AndroidLogo className="h-7 w-7 shrink-0 text-amber-600 dark:text-amber-400" />
							<span className="leading-tight">
								<span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
									Download for
								</span>
								<span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
									Android{" "}
									<span className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/70">
										{ANDROID_VERSION}
									</span>
								</span>
							</span>
						</a>
						<a
							href={MACOS_DMG_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex w-56 items-center gap-3 rounded-xl gradient-border glass-card px-4 py-2.5 text-left transition-all duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-amber-500/40 dark:hover:border-amber-400/30"
						>
							<AppleLogo className="h-7 w-7 shrink-0 text-amber-600 dark:text-amber-400" />
							<span className="leading-tight">
								<span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
									Download for
								</span>
								<span className="block text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
									macOS{" "}
									<span className="text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/70">
										{MACOS_VERSION}
									</span>
								</span>
							</span>
						</a>
					</div>
				</div>
			</div>
		</div>
	);
};

export default WelcomeScreen;
