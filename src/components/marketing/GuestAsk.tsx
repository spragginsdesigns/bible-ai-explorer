"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import { PublicAnswerMarkdown } from "@/components/shared/SharedAnswerView";
import { stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import { commonQuestions } from "@/utils/commonQuestions";
import { durationBucket } from "@/lib/analytics/events";
import { trackGuestAnswer, trackGuestLimit, trackLandingCta } from "@/lib/analytics/client";
import { GUEST_PENDING_KEY } from "@/lib/guest-client";
import styles from "./guest-ask.module.css";

/**
 * Try before you sign up (docs/FEATURES.md): a signed-out visitor asks from
 * the landing page and reads a real answer, then is offered an account to
 * keep going and to keep what they asked.
 *
 * The route (/api/guest/ask) decides every limit; this component only shows
 * what it said. `GUEST_PENDING_KEY` is how the signed-in app knows, after
 * sign-up, that this browser has guest turns to adopt: it is set once an
 * answer finishes, so it holds whichever button on the page the visitor
 * eventually signs up through.
 */

const MAX_QUESTION_LENGTH = 1000;
const SAMPLE_QUESTIONS = commonQuestions.slice(0, 3);
const FOLLOW_UP_LINE = /^[ \t]*\[FOLLOWUP\][ \t]*(.+)$/gm;

interface Turn {
	question: string;
	answer: string;
	done: boolean;
}

function followUpsOf(text: string): string[] {
	return Array.from(text.matchAll(FOLLOW_UP_LINE), (match) => match[1].trim())
		.filter(Boolean)
		.slice(0, 2);
}

function markPending() {
	try {
		window.localStorage.setItem(GUEST_PENDING_KEY, "1");
	} catch {
		// Private mode: the answer still shows, it just cannot be adopted later.
	}
}

export default function GuestAsk() {
	const [turns, setTurns] = useState<Turn[]>([]);
	const [input, setInput] = useState("");
	const [streaming, setStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [remaining, setRemaining] = useState<number | null>(null);
	const [limitMessage, setLimitMessage] = useState<string | null>(null);

	const ask = async (raw: string) => {
		const question = raw.trim();
		if (!question || streaming || limitMessage) return;
		setError(null);
		setInput("");
		setStreaming(true);
		setTurns((current) => [...current, { question, answer: "", done: false }]);
		const startedAt = performance.now();
		const dropLastTurn = () => setTurns((current) => current.slice(0, -1));

		try {
			const response = await fetch("/api/guest/ask", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question }),
			});

			if (!response.ok || !response.body) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
					code?: string;
					reason?: string;
				} | null;
				dropLastTurn();
				if (body?.code === "guest_limit") {
					setLimitMessage(body.error ?? "Create a free account to keep asking.");
					setRemaining(0);
					trackGuestLimit(body.reason ?? "guest");
					return;
				}
				setInput(question);
				setError(body?.error ?? "SureWord couldn't answer just now. Please try again.");
				return;
			}

			const left = Number(response.headers.get("X-Guest-Remaining"));
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let text = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
				const partial = text;
				setTurns((current) =>
					current.map((turn, index) =>
						index === current.length - 1 ? { ...turn, answer: partial } : turn
					)
				);
			}
			text += decoder.decode();

			if (!stripFollowUpMarkers(text, { streaming: false }).trim()) {
				dropLastTurn();
				setInput(question);
				setError("SureWord couldn't answer that just now. Please try again.");
				return;
			}

			setTurns((current) =>
				current.map((turn, index) =>
					index === current.length - 1 ? { ...turn, answer: text, done: true } : turn
				)
			);
			markPending();
			const leftAfter = Number.isFinite(left) ? left : null;
			setRemaining(leftAfter);
			trackGuestAnswer(leftAfter ?? -1, durationBucket(performance.now() - startedAt));
			if (leftAfter === 0) {
				setLimitMessage("That was your last free answer for today. Create a free account to keep going.");
				trackGuestLimit("guest");
			}
		} catch {
			dropLastTurn();
			setInput(question);
			setError("SureWord couldn't be reached. Check your connection and try again.");
		} finally {
			setStreaming(false);
		}
	};

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		void ask(input);
	};

	const lastTurn = turns[turns.length - 1];
	const followUps = lastTurn?.done && !limitMessage ? followUpsOf(lastTurn.answer) : [];

	return (
		<section id="ask" className={styles.section} aria-labelledby="ask-heading">
			<p className={styles.eyebrow}>Try it now · no account needed</p>
			<h2 id="ask-heading" className={styles.heading}>
				Ask SureWord <em>a question.</em>
			</h2>
			<p className={styles.lede}>
				A real answer, grounded in the King James Bible. Your first three are free,
				before you make an account.
			</p>

			{turns.length > 0 && (
				<div className={styles.thread} aria-live="polite">
					{turns.map((turn, index) => {
						const shown = stripFollowUpMarkers(turn.answer, { streaming: !turn.done });
						return (
							<article key={index} className={styles.turn}>
								<p className={styles.question}>{turn.question}</p>
								{shown ? (
									<div className={`dark ${styles.answer}`}>
										<PublicAnswerMarkdown answer={shown} translation="KJV" />
									</div>
								) : (
									<p className={styles.searching}>Searching the Scriptures…</p>
								)}
							</article>
						);
					})}
				</div>
			)}

			{followUps.length > 0 && (
				<div className={styles.chips} aria-label="Suggested next questions">
					{followUps.map((question) => (
						<button
							key={question}
							type="button"
							className={styles.chip}
							disabled={streaming}
							onClick={() => void ask(question)}
						>
							{question}
						</button>
					))}
				</div>
			)}

			{limitMessage ? (
				<div className={styles.limit} role="status">
					<p>{limitMessage}</p>
					<p className={styles.fine}>
						{turns.length > 0
							? "What you asked here is saved to your new account."
							: "Free accounts include daily AI answers, notes, highlights and saved study."}
					</p>
					<Link
						href="/sign-up"
						className={styles.primary}
						onClick={() => trackLandingCta("guest_limit_sign_up")}
					>
						Create a free account <ArrowRight size={17} />
					</Link>
				</div>
			) : (
				<form className={styles.form} onSubmit={onSubmit}>
					<label htmlFor="guest-question" className={styles.srOnly}>
						Your Bible question
					</label>
					<textarea
						id="guest-question"
						className={styles.input}
						rows={2}
						maxLength={MAX_QUESTION_LENGTH}
						placeholder={turns.length ? "Ask a follow-up…" : "What does the Bible say about…"}
						value={input}
						disabled={streaming}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void ask(input);
							}
						}}
					/>
					<button
						type="submit"
						className={styles.send}
						disabled={streaming || !input.trim()}
						aria-label="Ask"
					>
						<Send size={18} />
					</button>
				</form>
			)}

			{turns.length === 0 && !limitMessage && (
				<div className={styles.chips} aria-label="Example questions">
					{SAMPLE_QUESTIONS.map((question) => (
						<button
							key={question}
							type="button"
							className={styles.chip}
							disabled={streaming}
							onClick={() => void ask(question)}
						>
							{question}
						</button>
					))}
				</div>
			)}

			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}

			{lastTurn?.done && !limitMessage && (
				<p className={styles.fine}>
					{remaining !== null && remaining > 0
						? `${remaining} free ${remaining === 1 ? "answer" : "answers"} left. `
						: ""}
					<Link href="/sign-up" onClick={() => trackLandingCta("guest_save")}>
						Save this study with a free account
					</Link>
				</p>
			)}
		</section>
	);
}
