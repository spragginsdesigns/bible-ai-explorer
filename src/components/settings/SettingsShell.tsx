"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Menu, X } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import SettingsSectionNav from "./SettingsSectionNav";
import { paneById, useSettingsPane } from "./settingsPanes";

/**
 * Settings shell: the docked app sidebar on desktop, listing the Settings
 * pages in its contextual band, and below `lg` the same 56px top bar the chat
 * gets, so the drawer (and the chat history in it) is reachable from Settings
 * instead of the page being a dead end. On a phone the bar also carries the
 * back step from a page to the hub, as a pushed screen does on Android.
 */
const SettingsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [pane, openPane] = useSettingsPane();

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
					{pane ? (
						<button
							type="button"
							onClick={() => openPane(null)}
							aria-label="Back to Settings"
							className="-ml-2 flex min-h-[44px] items-center gap-0.5 pr-2 text-sm font-semibold text-amber-700 transition-colors hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
						>
							<ChevronLeft className="h-5 w-5" />
							Settings
						</button>
					) : (
						<button
							type="button"
							onClick={() => setSidebarOpen(true)}
							aria-label="Open sidebar"
							className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
						>
							<Menu className="h-5 w-5" />
						</button>
					)}
					<span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-neutral-700 dark:text-neutral-300">
						{pane ? paneById(pane).title : "Settings"}
					</span>
					<Link
						href="/"
						aria-label="Close settings"
						title="Close settings"
						className="flex min-h-[44px] min-w-[44px] items-center justify-center text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
					>
						<X className="h-5 w-5" />
					</Link>
				</header>
				<main>{children}</main>
			</div>
		</div>
	);
};

export default SettingsShell;
