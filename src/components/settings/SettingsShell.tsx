"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Menu } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import SettingsSectionNav from "./SettingsSectionNav";

/**
 * Settings shell: the docked app sidebar on desktop, and below `lg` the same
 * 56px top bar the chat gets, so the drawer (and the chat history in it) is
 * reachable from Settings instead of the page being a dead end.
 */
const SettingsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<AppSidebar
				active="settings"
				docked
				mobileDrawer
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
			>
				<SettingsSectionNav onNavigate={() => setSidebarOpen(false)} />
			</AppSidebar>

			<div className="lg:pl-[268px]">
				<header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center gap-1 border-b border-black/[0.08] px-4 glass lg:hidden dark:border-white/[0.06]">
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="Open sidebar"
						className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
					>
						<Menu className="h-5 w-5" />
					</button>
					<span className="truncate text-sm font-semibold text-neutral-700 dark:text-neutral-300">
						Settings
					</span>
					<Link
						href="/"
						aria-label="Back to chat"
						title="Back to chat"
						className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
					>
						<ArrowLeft className="h-5 w-5" />
					</Link>
				</header>
				<main>{children}</main>
			</div>
		</div>
	);
};

export default SettingsShell;
