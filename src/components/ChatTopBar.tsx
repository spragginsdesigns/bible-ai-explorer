"use client";

import React from "react";
import Link from "next/link";
import { Menu, Sun, Moon, SquarePen, MessageSquare, BookOpen } from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";

interface ChatTopBarProps {
	title: string;
	onToggleSidebar: () => void;
	onNewChat: () => void;
}

const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar, onNewChat }) => {
	const { setTheme } = useTheme();

	return (
		<div className="h-14 flex items-center justify-between px-4 border-b border-black/[0.08] dark:border-white/[0.06] glass flex-shrink-0">
			<div className="flex items-center gap-1 min-w-0">
				<button
					onClick={onToggleSidebar}
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<Menu className="w-5 h-5" />
				</button>

				{/* Navigation tabs */}
				<nav className="flex items-center gap-1 ml-1">
					<Link
						href="/"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-amber-600 dark:text-amber-400 bg-black/[0.04] dark:bg-white/[0.04] border-b-2 border-amber-600 dark:border-amber-400 transition-colors"
					>
						<MessageSquare className="w-3.5 h-3.5" />
						Chat
					</Link>
					<Link
						href="/notes"
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
					>
						<BookOpen className="w-3.5 h-3.5" />
						Notes
					</Link>
				</nav>
			</div>
			<div className="flex items-center gap-0">
				<button
					onClick={onNewChat}
					title="New Chat"
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<SquarePen className="w-4 h-4" />
				</button>
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
				<div className="ml-1 flex items-center">
					<UserButton afterSignOutUrl="/sign-in" />
				</div>
			</div>
		</div>
	);
};

export default ChatTopBar;
