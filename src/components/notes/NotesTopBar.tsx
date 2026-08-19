"use client";

import React from "react";
import Link from "next/link";
import {
	Menu,
	FilePlus,
	MessageSquare,
	BookOpen,
	BookMarked,
	Smartphone,
	Sun,
	Moon,
	Settings,
} from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";
import { ANDROID_APK_URL } from "@/lib/constants";

interface NotesTopBarProps {
	onToggleSidebar: () => void;
	onNewNote: () => void;
}

const NotesTopBar: React.FC<NotesTopBarProps> = ({ onToggleSidebar, onNewNote }) => {
	const { setTheme } = useTheme();

	return (
		<div className="h-14 flex items-center justify-between px-4 border-b border-black/[0.08] dark:border-white/[0.06] glass flex-shrink-0">
			<div className="flex items-center gap-1 min-w-0">
				{/* Sidebar toggle (mobile only - the sidebar is persistent on desktop) */}
				<button
					onClick={onToggleSidebar}
					aria-label="Toggle sidebar"
					className="lg:hidden text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<Menu className="w-5 h-5" />
				</button>

				{/* Navigation tabs (desktop; mobile uses MobileBottomNav) */}
				<nav className="hidden lg:flex items-center gap-1 ml-1">
					<Link
						href="/"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
					>
						<MessageSquare className="w-3.5 h-3.5" />
						Chat
					</Link>
					<Link
						href="/bible"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
					>
						<BookMarked className="w-3.5 h-3.5" />
						Bible
					</Link>
					<Link
						href="/notes"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-amber-600 dark:text-amber-400 bg-black/[0.04] dark:bg-white/[0.04] border-b-2 border-amber-600 dark:border-amber-400 transition-colors"
					>
						<BookOpen className="w-3.5 h-3.5" />
						Notes
					</Link>
				</nav>
			</div>
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
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<Settings className="w-4 h-4" />
				</Link>
				<div className="ml-1 hidden lg:flex items-center">
					<UserButton />
				</div>
			</div>
		</div>
	);
};

export default NotesTopBar;
