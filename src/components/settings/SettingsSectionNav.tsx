"use client";

import React, { useState } from "react";
import { Search, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import {
	SETTINGS_GROUPS,
	SETTINGS_PANES,
	paneMatches,
	useSettingsPane,
	type SettingsPane,
} from "./settingsPanes";

interface SettingsSectionNavProps {
	/** Closes the mobile drawer once a page has been opened. */
	onNavigate?: () => void;
}

/** A rounded, filled square holding the page's icon, as in System Settings. */
export function PaneTile({ pane, size = "sm" }: { pane: SettingsPane; size?: "sm" | "md" | "lg" }) {
	const box =
		size === "lg"
			? "h-11 w-11 rounded-[12px]"
			: size === "md"
				? "h-8 w-8 rounded-[9px]"
				: "h-6 w-6 rounded-[7px]";
	const glyph = size === "lg" ? "h-[22px] w-[22px]" : size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
	return (
		<span
			aria-hidden
			className={`flex flex-shrink-0 items-center justify-center bg-gradient-to-b text-white shadow-sm ring-1 ring-inset ring-white/15 ${pane.tile} ${box}`}
		>
			<pane.Icon className={glyph} strokeWidth={2.25} />
		</span>
	);
}

/** The signed-in person's initial on a gold disc, or their Clerk photo. */
export function AccountAvatar({ size = 32 }: { size?: number }) {
	const { user } = useUser();
	const name = user?.fullName ?? user?.username ?? "";
	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const initial = (name || email || "✝").trim().charAt(0).toUpperCase();
	return (
		<span
			aria-hidden
			style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${size * 0.42 / 16}rem` }}
			className="relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber-500/40 bg-amber-500/10 font-bold text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400"
		>
			{initial}
			{user?.hasImage && user.imageUrl ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img src={user.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
			) : null}
		</span>
	);
}

/**
 * The sidebar's contextual band on Settings: a searchable list of pages, the
 * account row on top and then Study, Assistant and App, the same list the
 * Mac's Settings sidebar shows. Each row opens one page beside it.
 */
const SettingsSectionNav: React.FC<SettingsSectionNavProps> = ({ onNavigate }) => {
	const { user } = useUser();
	const [active] = useSettingsPane();
	const [query, setQuery] = useState("");

	const name = user?.fullName ?? user?.username ?? "";
	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const visible = SETTINGS_PANES.filter((pane) => paneMatches(pane, query));
	const account = visible.find((pane) => pane.id === "account");

	const rowClass = (selected: boolean) =>
		`flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-control transition-colors ${
			selected
				? "sidebar-glass-control border font-semibold text-neutral-900 dark:text-neutral-100"
				: "border border-transparent text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.04] dark:hover:text-neutral-100"
		}`;

	return (
		<nav aria-label="Settings pages" className="flex flex-col gap-0.5 pb-3">
			<label className="mb-2 flex h-9 items-center gap-2 rounded-xl border border-black/[0.08] bg-black/[0.03] px-2.5 text-neutral-400 focus-within:border-amber-500/40 dark:border-white/[0.08] dark:bg-white/[0.03]">
				<Search className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && visible[0]) {
							window.location.hash = visible[0].id;
							onNavigate?.();
						}
					}}
					placeholder="Search settings"
					aria-label="Search settings"
					className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200 [&::-webkit-search-cancel-button]:hidden"
				/>
				{query ? (
					<button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
						<X className="h-3.5 w-3.5" />
					</button>
				) : null}
			</label>

			{account ? (
				<a
					href="#account"
					onClick={onNavigate}
					aria-current={active === "account" ? "page" : undefined}
					className={`${rowClass(active === "account")} mb-1 py-2`}
				>
					<AccountAvatar size={30} />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[0.8125rem] font-semibold text-neutral-900 dark:text-neutral-100">
							{name || email || "Signed in"}
						</span>
						<span className="block truncate text-metadata text-neutral-400 dark:text-neutral-500">
							{name && email ? email : "SureWord account"}
						</span>
					</span>
				</a>
			) : null}

			{SETTINGS_GROUPS.map((group) => {
				const rows = visible.filter((pane) => pane.group === group.id);
				if (rows.length === 0) return null;
				return (
					<div key={group.id} className="flex flex-col gap-0.5">
						<p className="px-2.5 pb-1 pt-3 text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-600">
							{group.title}
						</p>
						{rows.map((pane) => (
							<a
								key={pane.id}
								href={`#${pane.id}`}
								onClick={onNavigate}
								aria-current={active === pane.id ? "page" : undefined}
								className={rowClass(active === pane.id)}
							>
								<PaneTile pane={pane} />
								<span className="truncate">{pane.title}</span>
							</a>
						))}
					</div>
				);
			})}

			{visible.length === 0 ? (
				<p className="px-2.5 py-2 text-[0.8125rem] text-neutral-400 dark:text-neutral-500">
					No settings match &ldquo;{query.trim()}&rdquo;.
				</p>
			) : null}
		</nav>
	);
};

export default SettingsSectionNav;
