"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import {
	listShares,
	revokeShare,
	setShareListed,
	type SharedAnswerSummary,
} from "@/lib/chat/share-client";

/** How long "Copied" stays on a row before it goes quiet again. */
const COPIED_MS = 2000;

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Settings -> Shared answers (docs/FEATURES.md, "Share an answer: a public
 * page, and a card image").
 *
 * Every link the reader has ever minted, with the one control that matters:
 * Revoke. A revoked row is kept and labelled rather than dropped, because a
 * link that was out in the world is worth remembering, and the id is reused if
 * the same answer is ever shared again.
 *
 * The list is fetched on mount and never rendered on the server, so the
 * locale-formatted dates cannot disagree with a server pass.
 */
export default function SharedAnswersSection() {
	const [shares, setShares] = useState<SharedAnswerSummary[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);

	// The row whose "Show in search" is waiting on its confirmation.
	const [confirmListId, setConfirmListId] = useState<string | null>(null);

	/**
	 * Optimistic, like revoke. Only turning it ON asks first: publishing a
	 * question to search engines is the one step here that is hard to take
	 * back, because crawlers keep what they saw until they recrawl.
	 */
	const applyListed = async (share: SharedAnswerSummary, listed: boolean) => {
		if (pendingId) return;
		setConfirmListId(null);
		setPendingId(share.id);
		setActionError(null);
		setShares((current) =>
			current?.map((row) => (row.id === share.id ? { ...row, listed } : row)) ?? current
		);
		try {
			const settled = await setShareListed(share.id, listed);
			setShares((current) =>
				current?.map((row) => (row.id === share.id ? { ...row, listed: settled } : row)) ?? current
			);
		} catch (error) {
			setShares((current) =>
				current?.map((row) => (row.id === share.id ? { ...row, listed: share.listed } : row)) ??
				current
			);
			setActionError(error instanceof Error ? error.message : "Couldn't update that link.");
		} finally {
			setPendingId(null);
		}
	};

	const load = async () => {
		setLoadError(null);
		try {
			setShares(await listShares());
		} catch (error) {
			setShares(null);
			setLoadError(
				error instanceof Error ? error.message : "Couldn't load your shared answers."
			);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	useEffect(() => {
		if (!copiedId) return;
		const timer = setTimeout(() => setCopiedId(null), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copiedId]);

	const copy = async (share: SharedAnswerSummary) => {
		setActionError(null);
		try {
			await navigator.clipboard.writeText(share.url);
			setCopiedId(share.id);
		} catch {
			setActionError("Couldn't copy that link.");
		}
	};

	/**
	 * Optimistic: the row reads "Revoked" the moment it is tapped and goes back
	 * to active if the route refuses, the same pattern the chat thumbs use.
	 */
	const revoke = async (share: SharedAnswerSummary) => {
		if (pendingId) return;
		const stamp = new Date().toISOString();
		setPendingId(share.id);
		setActionError(null);
		setShares((current) =>
			current?.map((row) =>
				row.id === share.id ? { ...row, revokedAt: stamp, listed: false } : row
			) ?? current
		);
		try {
			await revokeShare(share.id);
		} catch (error) {
			setShares((current) =>
				current?.map((row) =>
					row.id === share.id
						? { ...row, revokedAt: share.revokedAt, listed: share.listed }
						: row
				) ?? current
			);
			setActionError(error instanceof Error ? error.message : "Couldn't revoke that link.");
		} finally {
			setPendingId(null);
		}
	};

	return (
		<section id="shared" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				SHARED ANSWERS
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
					Anyone with a link can read that one answer, signed out. Links stay unlisted unless
					you turn on Show in search. Revoking takes the page down; the rest of your
					conversation was never part of it.
				</p>

				{shares === null ? (
					<div className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3">
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							{loadError ?? "Loading shared answers…"}
						</p>
						{loadError ? (
							<button
								type="button"
								onClick={() => void load()}
								className="min-h-11 px-3 text-xs font-bold text-amber-600 dark:text-amber-400"
							>
								Retry
							</button>
						) : null}
					</div>
				) : shares.length === 0 ? (
					<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
						Answers you share appear here.
					</p>
				) : (
					<ul className="flex flex-col gap-2.5">
						{shares.map((share) => {
							const revoked = Boolean(share.revokedAt);
							const date = formatDate(share.createdAt);
							return (
								<li
									key={share.id}
									className="flex flex-col gap-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] p-3"
								>
									<div className="flex items-start gap-2">
										<p className="min-w-0 flex-1 line-clamp-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
											{share.question || "Shared answer"}
										</p>
										{revoked && (
											<span className="flex-shrink-0 rounded-full border border-black/[0.1] dark:border-white/[0.1] px-2 py-0.5 text-metadata font-bold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
												Revoked
											</span>
										)}
									</div>
									{date && (
										<p className="text-xs text-neutral-400 dark:text-neutral-500">
											Shared {date}
										</p>
									)}
									<p className="flex items-center gap-1.5 rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-white/60 dark:bg-black/20 px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
										<Link2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
										<span className="min-w-0 flex-1 truncate">{share.url}</span>
									</p>
									{!revoked && (
										<div className="flex min-h-11 items-center justify-between gap-3">
											<span
												id={`listed-${share.id}`}
												className="text-xs font-semibold text-neutral-600 dark:text-neutral-300"
											>
												Show in search
											</span>
											<button
												type="button"
												role="switch"
												aria-checked={share.listed}
												aria-labelledby={`listed-${share.id}`}
												disabled={pendingId === share.id}
												onClick={() =>
													share.listed
														? void applyListed(share, false)
														: setConfirmListId(share.id)
												}
												className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${
													share.listed ? "bg-amber-500" : "bg-neutral-300 dark:bg-neutral-700"
												}`}
											>
												<span
													aria-hidden
													className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
														share.listed ? "translate-x-5" : "translate-x-0.5"
													}`}
												/>
											</button>
										</div>
									)}
									{confirmListId === share.id && !share.listed && !revoked && (
										<div
											role="group"
											aria-label="Confirm showing this answer in search"
											className="flex flex-col gap-2 rounded-lg border border-amber-600/25 bg-amber-500/10 p-3"
										>
											<p className="text-xs leading-5 text-neutral-700 dark:text-neutral-200">
												Anyone will be able to find this question and answer on Google and other
												search engines. Your name is never shown. You can turn this off at any time.
											</p>
											<div className="flex items-center gap-3">
												<button
													type="button"
													onClick={() => void applyListed(share, true)}
													className="min-h-11 text-xs font-bold text-amber-700 dark:text-amber-400"
												>
													Show in search
												</button>
												<button
													type="button"
													onClick={() => setConfirmListId(null)}
													className="min-h-11 text-xs font-bold text-neutral-500 dark:text-neutral-400"
												>
													Cancel
												</button>
											</div>
										</div>
									)}
									<div className="flex items-center gap-3">
										{!revoked && (
											<button
												type="button"
												onClick={() => void copy(share)}
												className="min-h-11 text-xs font-bold text-amber-600 dark:text-amber-400 sm:min-h-0"
											>
												{copiedId === share.id ? "Copied" : "Copy link"}
											</button>
										)}
										{!revoked && (
											<button
												type="button"
												onClick={() => void revoke(share)}
												disabled={pendingId === share.id}
												className="min-h-11 text-xs font-bold text-red-600 disabled:opacity-50 dark:text-red-400 sm:min-h-0"
											>
												Revoke
											</button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}

				{actionError && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{actionError}
					</p>
				)}
			</div>
		</section>
	);
}
