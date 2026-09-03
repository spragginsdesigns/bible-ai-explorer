"use client";

import React from "react";

interface SettingsSectionNavProps {
	/** Closes the mobile drawer once a section has been jumped to. */
	onNavigate?: () => void;
}

const SECTIONS = [
	{ id: "appearance", label: "Appearance" },
	{ id: "translation", label: "Bible translation" },
	{ id: "memory", label: "Memory" },
	{ id: "web-search", label: "Web search" },
	{ id: "church", label: "My church" },
	{ id: "providers", label: "AI providers" },
	{ id: "account", label: "Account" },
	{ id: "get-the-app", label: "Get the app" },
	{ id: "about", label: "About" },
] as const;

/**
 * The sidebar's contextual section on Settings. Chat fills this band with its
 * conversation list; Settings had nothing there, leaving ~650px of empty
 * sidebar on every visit. These jump links fill it without pulling the chat
 * state (and its history fetch) into a page that has no use for it.
 */
const SettingsSectionNav: React.FC<SettingsSectionNavProps> = ({ onNavigate }) => (
	<nav aria-label="Settings sections" className="flex flex-col pb-3">
		<p className="px-3 pb-1.5 text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-600">
			On this page
		</p>
		{SECTIONS.map((section) => (
			<a
				key={section.id}
				href={`#${section.id}`}
				onClick={onNavigate}
				className="rounded-xl px-3 py-2.5 text-control text-neutral-600 transition-colors hover:bg-black/[0.03] hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-white/[0.03] dark:hover:text-neutral-300"
			>
				{section.label}
			</a>
		))}
	</nav>
);

export default SettingsSectionNav;
