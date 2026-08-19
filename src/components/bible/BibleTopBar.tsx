"use client";

import React from "react";
import Link from "next/link";
import { Sun, Moon, MessageSquare, BookOpen, BookMarked, Smartphone, Settings } from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";
import { ANDROID_APK_URL } from "@/lib/constants";

/**
 * Desktop top bar for the Bible section: the same glass bar the chat and
 * notes screens get from ChatTopBar/NotesTopBar, with the Bible tab active.
 * Desktop-only (lg+) — below that breakpoint MobileBottomNav carries the
 * tab navigation, and each Bible screen already has its own in-content
 * header.
 */
const BibleTopBar: React.FC = () => {
	const { setTheme } = useTheme();

	return (
		<div className="h-14 hidden lg:flex items-center justify-between px-4 border-b border-black/[0.08] dark:border-white/[0.06] glass flex-shrink-0">
			{/* Navigation tabs (desktop; mobile uses MobileBottomNav) */}
			<nav className="flex items-center gap-1 ml-1">
				<Link
					href="/"
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
				>
					<MessageSquare className="w-3.5 h-3.5" />
					Chat
				</Link>
				<Link
					href="/bible"
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-amber-600 dark:text-amber-400 bg-black/[0.04] dark:bg-white/[0.04] border-b-2 border-amber-600 dark:border-amber-400 transition-colors"
				>
					<BookMarked className="w-3.5 h-3.5" />
					Bible
				</Link>
				<Link
					href="/notes"
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
				>
					<BookOpen className="w-3.5 h-3.5" />
					Notes
				</Link>
			</nav>
			<div className="flex items-center gap-0">
				<a
					href={ANDROID_APK_URL}
					target="_blank"
					rel="noopener noreferrer"
					title="Get the Android app"
					aria-label="Get the Android app"
					className="text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<Smartphone className="w-4 h-4" />
				</a>
				<button
					onClick={() => {
						const isDark = document.documentElement.classList.contains("dark");
						setTheme(isDark ? "light" : "dark");
					}}
					className="text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<Sun className="w-4 h-4 hidden dark:block" />
					<Moon className="w-4 h-4 block dark:hidden" />
				</button>
				<Link
					href="/settings"
					title="Settings"
					aria-label="Settings"
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<Settings className="w-4 h-4" />
				</Link>
				<div className="ml-1 flex items-center">
					{/* afterSignOutUrl was removed from UserButton in @clerk/nextjs v7.
					    Nothing is lost: signing out drops the session, the next
					    protected page hits the middleware, and that redirects to
					    /sign-in. */}
					<UserButton />
				</div>
			</div>
		</div>
	);
};

export default BibleTopBar;
