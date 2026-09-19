"use client";

import { useState } from "react";
import {
	FEEDBACK_CATEGORIES,
	MAX_FEEDBACK_MESSAGE_LENGTH,
	type FeedbackCategoryId,
} from "@/lib/feedback/in-app-feedback";
import { WEB_VERSION } from "@/lib/constants";

/**
 * Send feedback (docs/FEATURES.md, "Send feedback").
 *
 * Usage numbers can say that people stop after their first answer; only a
 * person can say why. This is the one place in the app where they get to say
 * it in their own words, so it asks for as little as possible around the
 * message: what it is about, the message, and an address only if they want an
 * answer back.
 *
 * The category chips are picked rather than typed because a bug and an idea go
 * to different places in a reader's head, and four choices is a decision
 * rather than a form.
 */
export default function FeedbackSection() {
	const [category, setCategory] = useState<FeedbackCategoryId>("bug");
	const [message, setMessage] = useState("");
	const [replyEmail, setReplyEmail] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const send = async () => {
		const trimmed = message.trim();
		if (sending || trimmed.length === 0) return;
		setSending(true);
		setError(null);
		try {
			const response = await fetch("/api/feedback", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", "x-sureword-client": "web" },
				body: JSON.stringify({
					category,
					message: trimmed,
					appVersion: WEB_VERSION,
					...(replyEmail.trim() ? { replyEmail: replyEmail.trim() } : {}),
				}),
			});
			const body: unknown = await response.json().catch(() => null);
			if (!response.ok) {
				const detail =
					typeof body === "object" && body !== null && "error" in body
						? String((body as { error: unknown }).error)
						: null;
				setError(detail ?? `Could not send that (${response.status}).`);
				return;
			}
			setSent(true);
			setMessage("");
			setReplyEmail("");
		} catch {
			setError("Could not reach the server. Check your connection and try again.");
		} finally {
			setSending(false);
		}
	};

	return (
		<section id="feedback" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				SEND FEEDBACK
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
					Tell us what is broken, what is missing, or what you would want SureWord to do. A
					person reads every one of these.
				</p>

				{sent ? (
					<div className="flex flex-col gap-3">
						<p className="text-sm leading-6 text-neutral-700 dark:text-neutral-200">
							Thank you. That went straight through, and it is read by a person rather than
							counted by a machine.
						</p>
						<button
							type="button"
							onClick={() => setSent(false)}
							className="min-h-11 self-start rounded-xl border border-black/[0.1] dark:border-white/[0.12] px-4 text-sm font-bold text-neutral-700 dark:text-neutral-200"
						>
							Send something else
						</button>
					</div>
				) : (
					<>
						<div className="flex flex-wrap gap-2">
							{FEEDBACK_CATEGORIES.map((option) => {
								const active = option.id === category;
								return (
									<button
										key={option.id}
										type="button"
										aria-pressed={active}
										onClick={() => setCategory(option.id)}
										className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${
											active
												? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300"
												: "border-black/[0.1] dark:border-white/[0.12] text-neutral-600 dark:text-neutral-300"
										}`}
									>
										{option.label}
									</button>
								);
							})}
						</div>

						<label className="min-w-0">
							<span className="sr-only">Your feedback</span>
							<textarea
								value={message}
								onChange={(event) => {
									setMessage(event.target.value);
									setError(null);
								}}
								maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
								rows={5}
								placeholder="The Listen button never finished loading for me this morning…"
								className="w-full resize-y rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 py-2 text-sm leading-6 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15"
							/>
						</label>

						<label className="min-w-0 flex flex-col gap-1">
							<span className="text-xs text-neutral-500 dark:text-neutral-400">
								Email, only if you want a reply
							</span>
							<input
								type="email"
								inputMode="email"
								autoComplete="email"
								value={replyEmail}
								onChange={(event) => {
									setReplyEmail(event.target.value);
									setError(null);
								}}
								placeholder="you@example.com"
								className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15"
							/>
						</label>

						<p className="text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
							{message.length} / {MAX_FEEDBACK_MESSAGE_LENGTH}
						</p>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
							<p
								aria-live="polite"
								className={`min-w-0 flex-1 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}
							>
								{error ? error : sending ? "Sending…" : ""}
							</p>
							<button
								type="button"
								onClick={() => void send()}
								disabled={sending || message.trim().length === 0}
								className="min-h-11 flex-shrink-0 rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
							>
								{sending ? "Sending…" : "Send"}
							</button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
