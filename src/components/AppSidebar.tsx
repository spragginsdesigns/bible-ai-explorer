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
	Network,
	Compass,
	Brain,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { PRIMARY_DESTINATIONS, primarySectionForPath, type PrimarySection } from "@/lib/primary-navigation";
import { useTheme } from "next-themes";
import { UserButton, useUser } from "@clerk/nextjs";
import GetAppLink from "./GetAppLink";
import { useModalFocus } from "./useModalFocus";

/** Tailwind's `lg` breakpoint, above which the sidebar is static furniture. */
const DESKTOP_QUERY = "(min-width: 1024px)";

type SectionId = PrimarySection | "notes" | "settings";

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
	/**
	 * Docked pages that still want the drawer on mobile (Settings). Without
	 * it a docked sidebar is simply absent below `lg`, which leaves those
	 * pages with no way to reach the chat history.
	 */
	mobileDrawer?: boolean;
	/** Mobile drawer state (ignored by docked pages that opt out above). */
	open?: boolean;
	onClose?: () => void;
	/** Contextual middle section: chat history, note folders, etc. */
	children?: React.ReactNode;
}

const ICONS = { today: Sun, bible: BookMarked, chat: MessageSquare, connections: Network, study: Compass };
const CHILDREN = {
	today: [{ href: "/cross", label: "Pick Up Your Cross" }, { href: "/bible/plan", label: "Reading plan" }, { href: "/bible/learn", label: "Learn a verse" }, { href: "/bible/history", label: "Your walk & reading log" }],
	bible: [{ href: "/bible/search", label: "Search Scripture" }],
	study: [{ href: "/notes", label: "Notes" }, { href: "/bible/timeline", label: "Timeline, people & places" }],
};

/**
 * The app-wide left sidebar (ChatGPT-style): brand, primary nav, a
 * per-section contextual area, and the account/utilities footer. Rendered
 * persistently on desktop by every section; on mobile it is either a
 * slide-over drawer (chat, notes) or not rendered at all (docked pages).
 */
const AppSidebar: React.FC<AppSidebarProps> = ({
	active,
	docked = false,
	mobileDrawer = false,
	open = false,
	onClose,
	children,
}) => {
	const { setTheme } = useTheme();
	const { user } = useUser();
	const pathname = usePathname();
	const selectedSection = primarySectionForPath(pathname) ?? (active === "notes" ? "study" : active);

	const name = user?.fullName ?? user?.username ?? "";
	const email = user?.primaryEmailAddress?.emailAddress ?? "";

	// Starts true so the desktop sidebar is never briefly inert before hydration;
	// a mobile client corrects it in the effect below on its first commit.
	const [isDesktop, setIsDesktop] = React.useState(true);

	React.useEffect(() => {
		const query = window.matchMedia(DESKTOP_QUERY);
		const sync = () => setIsDesktop(query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);

	const drawer = !docked || mobileDrawer;
	// Below `lg` the drawer is a true overlay, so it owns focus while open and
	// must leave the focus order entirely while closed: it stays mounted and
	// merely translated off-screen, which keeps its links tabbable.
	const overlay = drawer && !isDesktop;
	const asideRef = useModalFocus<HTMLElement>({
		open: overlay && open,
		onClose: onClose ?? (() => {}),
		// Clerk's UserButton opens its menu in a portal outside the aside.
		allowPortalFocus: true,
		inertWhenClosed: overlay,
	});

	const slide = open ? "translate-x-0" : "-translate-x-full lg:translate-x-0";

	const positioning = docked
		? mobileDrawer
			? `flex fixed inset-y-0 left-0 transition-transform duration-200 ease-in-out ${slide}`
			: "hidden lg:flex fixed inset-y-0 left-0"
		: `flex fixed lg:relative top-0 left-0 h-full transition-transform duration-200 ease-in-out ${slide}`;

	return (
		<>
			{/* Mobile backdrop. z-45 rather than z-40: MobileBottomNav is also
			    z-40 and paints later in the document, so at the same level the
			    tab bar stayed bright and clickable through the scrim. */}
			{drawer && open && (
				<div
					className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[45] lg:hidden"
					onClick={onClose}
				/>
			)}

			<aside
				ref={asideRef}
				tabIndex={overlay && open ? -1 : undefined}
				className={`${positioning} z-50 w-[85vw] max-w-72 lg:w-[268px] flex-col liquid-glass-panel outline-none`}
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
						href="/today"
						className="sidebar-brand-wordmark text-[23px] leading-none font-normal text-amber-600 dark:text-amber-300 font-[family-name:var(--font-pirata)]"
					>
						SureWord
					</Link>
					{drawer && (
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
				<nav aria-label="Primary" className="flex max-h-[60dvh] shrink-0 flex-col gap-1 overflow-y-auto px-3 pb-3 custom-scrollbar">
					{PRIMARY_DESTINATIONS.map(({ id, href, label }) => {
						const Icon = ICONS[id];
						const isActive = selectedSection === id;
						return (
							<div key={id}>
							<Link
								href={href}
								aria-current={isActive ? "page" : undefined}
								className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-control font-medium border transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:scale-[0.985] ${
									isActive
										? "sidebar-glass-control text-amber-700 dark:text-amber-300"
										: "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] border-transparent"
								}`}
							>
								<Icon className="w-4 h-4" />
								{label}
							</Link>
							{isActive && id in CHILDREN && <div className="ml-5 mt-1 border-l border-amber-700/15 pl-2 dark:border-amber-300/15">
								{CHILDREN[id as keyof typeof CHILDREN].map(child => <Link key={child.href} href={child.href} onClick={onClose} aria-current={pathname === child.href ? "page" : undefined} className="flex min-h-10 items-center rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900 aria-[current=page]:font-bold aria-[current=page]:text-amber-700 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100 dark:aria-[current=page]:text-amber-300">{child.label}</Link>)}
							</div>}
							</div>
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
				<div className="flex items-center gap-1 px-4 pb-2 text-sm text-neutral-500 dark:text-neutral-400">
					<Link href="/notes" className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:text-amber-700 dark:hover:text-amber-300"><BookOpen size={16} aria-hidden /> Notes</Link>
					<Link href="/settings#memory" className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:text-amber-700 dark:hover:text-amber-300"><Brain size={16} aria-hidden /> Memories</Link>
				</div>

				{/* Footer: account + utilities */}
				<div className="border-t border-black/[0.06] dark:border-white/[0.06] p-3 flex items-center gap-2.5">
					<UserButton />
					<div className="min-w-0 flex-1">
						<p className="truncate text-metadata font-semibold text-neutral-800 dark:text-neutral-200">
							{name || email || "Signed in"}
						</p>
						{name && email && (
							<p className="truncate text-metadata text-neutral-400 dark:text-neutral-500">
								{email}
							</p>
						)}
					</div>
					<GetAppLink
						source="sidebar"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
					>
						<Smartphone className="w-4 h-4" />
					</GetAppLink>
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
