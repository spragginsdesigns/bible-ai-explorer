"use client";

import React from "react";

/** The card every settings group sits in. */
export const SETTINGS_CARD = "glass-card gradient-border rounded-2xl";

/** A labelled group: small caps heading above one card, like a grouped Form section. */
export function SettingsGroup({
	label,
	footer,
	children,
	className = "",
}: {
	label?: string;
	/** Hint text under the card, the way grouped Forms footnote a section. */
	footer?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className="flex flex-col gap-2">
			{label ? (
				<h2 className="px-1 text-metadata font-bold uppercase tracking-[0.15em] text-neutral-500">
					{label}
				</h2>
			) : null}
			<div className={`${SETTINGS_CARD} flex flex-col divide-y divide-black/[0.06] dark:divide-white/[0.06] ${className}`}>
				{children}
			</div>
			{footer ? (
				<p className="px-1 text-xs leading-[1.0625rem] text-neutral-400 dark:text-neutral-500">{footer}</p>
			) : null}
		</section>
	);
}

/** The amber pill switch used across Settings. */
export function Switch({
	checked,
	label,
	disabled,
	onChange,
}: {
	checked: boolean;
	label: string;
	disabled?: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-50 ${
				checked ? "bg-amber-500 dark:bg-amber-400" : "bg-black/[0.15] dark:bg-white/[0.15]"
			}`}
		>
			<span
				className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
					checked ? "translate-x-[22px]" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}

/** One row of a group: title, optional description, and a control on the right. */
export function SettingsRow({
	title,
	description,
	icon,
	control,
	children,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	icon?: React.ReactNode;
	control?: React.ReactNode;
	/** Anything that belongs under the row inside the same cell (errors, retry). */
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 px-4 py-3.5">
			<div className="flex items-center gap-3">
				{icon}
				<div className="min-w-0 flex-1">
					<p className="text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
					{description ? (
						<p className="mt-0.5 text-[0.8125rem] leading-[1.125rem] text-neutral-500 dark:text-neutral-400">
							{description}
						</p>
					) : null}
				</div>
				{control}
			</div>
			{children}
		</div>
	);
}
