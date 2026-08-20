"use client";

import React from "react";
import Link from "next/link";
import { Menu, Sun, Moon, SquarePen, Smartphone, Settings } from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";
import { ANDROID_APK_URL } from "@/lib/constants";

interface ChatTopBarProps {
	title: string;
	onToggleSidebar: () => void;
	onNewChat: () => void;
}

const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar, onNewChat }) => {
	const { setTheme } = useTheme();

	return (
		<div className="h-14 flex lg:hidden items-center justify-between px-4 border-b border-black/[0.08] dark:border-white/[0.06] glass flex-shrink-0">
			<div className="flex items-center gap-1 min-w-0">
				<button
					onClick={onToggleSidebar}
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<Menu className="w-5 h-5" />
				</button>
				<span className="truncate text-sm font-semibold text-neutral-700 dark:text-neutral-300">
					{title}
				</span>
			</div>
			<div className="flex items-center gap-0">
				<button
					onClick={onNewChat}
					title="New Chat"
					className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
				>
					<SquarePen className="w-4 h-4" />
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

export default ChatTopBar;
