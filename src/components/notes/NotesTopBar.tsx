"use client";

import React from "react";
import Link from "next/link";
import { Menu, FilePlus, Smartphone, Sun, Moon, Settings } from "lucide-react";
import { useTheme } from "next-themes";
import { ANDROID_APK_URL } from "@/lib/constants";

interface NotesTopBarProps {
	onToggleSidebar: () => void;
	onNewNote: () => void;
}

/**
 * Mobile-only top bar for Notes: opens the sidebar drawer and holds quick
 * actions. On desktop (lg+) the persistent AppSidebar carries navigation,
 * account, and utilities, so this bar hides entirely.
 */
const NotesTopBar: React.FC<NotesTopBarProps> = ({ onToggleSidebar, onNewNote }) => {
	const { setTheme } = useTheme();

	return (
		<div className="h-14 flex lg:hidden items-center justify-between px-4 border-b border-black/[0.08] dark:border-white/[0.06] glass flex-shrink-0">
			<button
				onClick={onToggleSidebar}
				aria-label="Toggle sidebar"
				className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
			>
				<Menu className="w-5 h-5" />
			</button>
			<div className="flex items-center gap-0">
				<button
					onClick={onNewNote}
					title="New Note"
					aria-label="New Note"
					className="text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<FilePlus className="w-4 h-4" />
				</button>
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
					aria-label="Toggle theme"
					className="text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<Sun className="w-4 h-4 hidden dark:block" />
					<Moon className="w-4 h-4 block dark:hidden" />
				</button>
				<Link
					href="/settings"
					title="Settings"
					aria-label="Settings"
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2"
				>
					<Settings className="w-4 h-4" />
				</Link>
			</div>
		</div>
	);
};

export default NotesTopBar;
