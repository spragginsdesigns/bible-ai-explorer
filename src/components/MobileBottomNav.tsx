"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile bottom navigation: a 1:1 port of the Android glass tab bar
 * (mobile/app/(app)/_layout.tsx). Same three tabs, same glyphs, same
 * floating-pill styling, same active/inactive colors. Rendered from the root
 * layout on every page; visible only below the lg breakpoint, where the top
 * bars hide their own tab nav. Hidden on the auth pages, which sit outside
 * the tab navigator on Android too.
 */
const TABS = [
	{ href: "/", label: "Chat", glyph: "✦", isActive: (pathname: string) => pathname === "/" },
	{ href: "/bible", label: "Bible", glyph: "✝", isActive: (pathname: string) => pathname.startsWith("/bible") },
	{ href: "/notes", label: "Notes", glyph: "✎", isActive: (pathname: string) => pathname.startsWith("/notes") },
] as const;

const HIDDEN_PREFIXES = ["/sign-in", "/sign-up"];

const MobileBottomNav: React.FC = () => {
	const pathname = usePathname();

	if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

	return (
		<nav
			aria-label="Primary"
			className="fixed inset-x-0 bottom-0 z-40 px-6 pb-[max(env(safe-area-inset-bottom),0.5rem)] lg:hidden"
		>
			<div className="liquid-glass flex overflow-hidden rounded-[24px] border border-black/[0.12] dark:border-white/[0.08]">
				{TABS.map((tab) => {
					const active = tab.isActive(pathname);
					return (
						<Link
							key={tab.href}
							href={tab.href}
							aria-current={active ? "page" : undefined}
							className={`flex flex-1 items-center justify-center gap-1.5 py-3.5 transition-colors active:opacity-70 ${
								active
									? "bg-amber-600/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
									: "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
							}`}
						>
							<span aria-hidden className="text-[15px] leading-none">
								{tab.glyph}
							</span>
							<span className="text-[13px] font-semibold">{tab.label}</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
};

export default MobileBottomNav;
