"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

interface Membership {
	plan: "free" | "pro";
	owner: boolean;
	enabled: boolean;
	access: "house" | "keys";
	hasPersonalKeys: boolean;
	usage: {
		dailyRemaining: number;
		monthlyRemaining: number | null;
		day: { end: string };
	} | null;
}

async function readMembership(response: Response): Promise<Membership> {
	const result = (await response.json().catch(() => null)) as (Membership & { error?: string }) | null;
	if (!response.ok || !result) throw new Error(result?.error ?? "Membership details are temporarily unavailable.");
	return result;
}

/**
 * Settings -> AI PROVIDERS, above the provider keys: plan, what is left of the
 * included allowance, when it resets, and who pays for AI. Mirrors Android's
 * MembershipSection (same /api/billing/status reads and PATCH, same copy);
 * purchasing and billing management stay on /membership.
 */
const MembershipSummary: React.FC = () => {
	const [data, setData] = useState<Membership | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	// Each request bumps this, so a slow load cannot overwrite a newer choice.
	const generation = useRef(0);

	const load = useCallback(() => {
		const current = ++generation.current;
		void fetch("/api/billing/status", { cache: "no-store" })
			.then(readMembership)
			.then((value) => {
				if (generation.current !== current) return;
				setData(value);
				setError("");
			})
			.catch(() => {
				if (generation.current === current) setError("Membership details are temporarily unavailable.");
			});
	}, []);

	useEffect(() => {
		// The counter itself, not a node: bumping it on unmount drops any reply
		// still in flight.
		const counter = generation;
		load();
		// Adding a personal key below (or paying on /membership in another tab)
		// changes what this card shows; refresh when the page regains focus.
		window.addEventListener("focus", load);
		return () => {
			window.removeEventListener("focus", load);
			counter.current++;
		};
	}, [load]);

	const choose = async (access: "house" | "keys") => {
		if (busy) return;
		const current = ++generation.current;
		setBusy(true);
		setError("");
		try {
			const value = await fetch("/api/billing/status", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ access }),
			}).then(readMembership);
			if (generation.current === current) setData(value);
		} catch (cause) {
			if (generation.current === current) {
				setError(cause instanceof Error ? cause.message : "Could not change AI choice.");
			}
		} finally {
			if (generation.current === current) setBusy(false);
		}
	};

	const title = data?.owner
		? "Owner membership"
		: data?.plan === "pro"
			? "SureWord Pro"
			: "Membership & included AI";

	return (
		<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3 mb-4">
			<div className="flex items-center gap-3">
				<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400">
					<Sparkles className="w-5 h-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
					{data?.owner ? (
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							All paid benefits and configured models are available without a subscription.
						</p>
					) : data?.usage ? null : (
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							{data ? "Continue studying free. Pro memberships are coming soon." : "Loading membership…"}
						</p>
					)}
				</div>
			</div>

			{!data?.owner && data?.usage ? (
				<div className="flex flex-col gap-1">
					<p className="text-[15px] font-bold text-amber-600 dark:text-amber-400">
						{data.usage.dailyRemaining} messages left today
					</p>
					{data.usage.monthlyRemaining !== null ? (
						<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
							{data.usage.monthlyRemaining} left this billing period
						</p>
					) : null}
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
						Daily reset: {new Date(data.usage.day.end).toLocaleString()}
					</p>
				</div>
			) : null}

			{data?.enabled && !data.owner ? (
				<>
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
						Included AI uses your SureWord allowance. Personal keys are billed by your provider.
					</p>
					<div className="flex flex-wrap gap-2" role="group" aria-label="Who pays for AI">
						{(["house", "keys"] as const).map((access) => {
							const disabled = busy || (access === "keys" && !data.hasPersonalKeys);
							const selected = data.access === access;
							return (
								<button
									key={access}
									type="button"
									disabled={disabled}
									aria-pressed={selected}
									onClick={() => void choose(access)}
									className={`min-h-11 rounded-lg border px-4 text-sm font-semibold transition-colors disabled:opacity-45 ${
										selected
											? "border-amber-500/60 dark:border-amber-400/50 bg-amber-500/10 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300"
											: "border-black/[0.12] dark:border-white/[0.15] text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
									}`}
								>
									{access === "house" ? "Included AI" : "My API key"}
								</button>
							);
						})}
					</div>
				</>
			) : null}

			<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
				Your Bible, notes, highlights and saved study remain available when your AI allowance runs out.
			</p>
			{error ? (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					{error}
				</p>
			) : null}

			<Link
				href="/membership"
				className="flex items-center justify-between rounded-xl border border-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/5"
			>
				<span>Membership &amp; included AI</span>
				<ChevronRight size={18} />
			</Link>
		</div>
	);
};

export default MembershipSummary;
