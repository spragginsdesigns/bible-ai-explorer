"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import {
	MessageSquare,
	BookMarked,
	BookOpen,
	Settings,
	Sun,
	Moon,
	Smartphone,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton, useUser } from "@clerk/nextjs";
import { ANDROID_APK_URL } from "@/lib/constants";

type SectionId = "chat" | "bible" | "notes" | "settings";

interface AppSidebarProps {
	/** Which primary section is active (highlights its nav pill). */
	active: SectionId;
	/**
	 * Docked mode for document-scroll pages (Bible, Settings): the sidebar is
	 * position-fixed on desktop and absent on mobile (those pages navigate via
	 * MobileBottomNav). Without it, the sidebar participates in the page's flex
	 * row on desktop and slides over as a drawer on mobile via open/onClose.
	 */
	docked?: boolean;
	/** Mobile drawer state (ignored in docked mode). */
	open?: boolean;
	onClose?: () => void;
	/** Contextual middle section: chat history, note folders, etc. */
	children?: React.ReactNode;
}

const NAV = [
	{ id: "chat", href: "/", label: "Chat", Icon: MessageSquare },
	{ id: "bible", href: "/bible", label: "Bible", Icon: BookMarked },
	{ id: "notes", href: "/notes", label: "Notes", Icon: BookOpen },
] as const;

/**
 * The app-wide left sidebar (ChatGPT-style): brand, primary nav, a
 * per-section contextual area, and the account/utilities footer. Rendered
 * persistently on desktop by every section; on mobile it is either a
 * slide-over drawer (chat, notes) or not rendered at all (docked pages).
 */
const AppSidebar: React.FC<AppSidebarProps> = ({
	active,
	docked = false,
	open = false,
	onClose,
	children,
}) => {
	const { setTheme } = useTheme();
	const { user } = useUser();

	const name = user?.fullName ?? user?.username ?? "";
	const email = user?.primaryEmailAddress?.emailAddress ?? "";

	const positioning = docked
		? "hidden lg:flex fixed inset-y-0 left-0"
		: `flex fixed lg:relative top-0 left-0 h-full transition-transform duration-200 ease-in-out ${
				open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
			}`;

	return (
		<>
			{/* Mobile backdrop */}
			{!docked && open && (
				<div
					className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
					onClick={onClose}
				/>
			)}

			<aside
				className={`${positioning} z-50 w-[85vw] max-w-72 lg:w-[268px] flex-col liquid-glass-panel`}
			>
				{/* Brand */}
				<div className="flex items-center gap-2.5 px-4 pt-4 pb-3.5">
					<Image
						src="/favicon-96x96.png"
						alt=""
						width={34}
						height={34}
						priority
						unoptimized
						className="sidebar-brand-icon shrink-0"
					/>
					<Link
						href="/"
						className="sidebar-brand-wordmark text-[23px] leading-none font-normal text-amber-600 dark:text-amber-300 font-[family-name:var(--font-pirata)]"
					>
						SureWord
					</Link>
					{!docked && (
						<button
							onClick={onClose}
							aria-label="Close sidebar"
							className="ml-auto lg:hidden text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors p-1"
						>
							<X className="w-5 h-5" />
						</button>
					)}
				</div>

				{/* Primary nav */}
				<nav className="flex flex-col gap-1 px-3 pb-3">
					{NAV.map(({ id, href, label, Icon }) => {
						const isActive = active === id;
						return (
							<Link
								key={id}
								href={href}
								aria-current={isActive ? "page" : undefined}
								className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-sm font-medium border transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.985] ${
									isActive
										? "sidebar-glass-control text-amber-700 dark:text-amber-300"
										: "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] border-transparent"
								}`}
							>
								<Icon className="w-4 h-4" />
								{label}
							</Link>
						);
					})}
				</nav>

				{/* Contextual section */}
				<div
					className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 ${
						children
							? "pt-3 border-t border-black/[0.06] dark:border-white/[0.06]"
							: ""
					}`}
				>
					{children}
				</div>

				{/* Footer: account + utilities */}
				<div className="border-t border-black/[0.06] dark:border-white/[0.06] p-3 flex items-center gap-2.5">
					<UserButton />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
							{name || email || "Signed in"}
						</p>
						{name && email && (
							<p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
								{email}
							</p>
						)}
					</div>
					<a
						href={ANDROID_APK_URL}
						target="_blank"
						rel="noopener noreferrer"
						title="Get the Android app"
						aria-label="Get the Android app"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
					>
						<Smartphone className="w-4 h-4" />
					</a>
					<button
						onClick={() => {
							const isDark = document.documentElement.classList.contains("dark");
							setTheme(isDark ? "light" : "dark");
						}}
						aria-label="Toggle theme"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
					>
						<Sun className="w-4 h-4 hidden dark:block" />
						<Moon className="w-4 h-4 block dark:hidden" />
					</button>
					<Link
						href="/settings"
						title="Settings"
						aria-label="Settings"
						className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
							active === "settings"
								? "text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-400/10"
								: "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
						}`}
					>
						<Settings className="w-4 h-4" />
					</Link>
				</div>
			</aside>
		</>
	);
};

export default AppSidebar;
