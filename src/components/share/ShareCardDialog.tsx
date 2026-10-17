"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Link2, Loader2, Share2, Type, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { consentFetch } from "@/lib/ai-consent-gate";
import { trackShareCard } from "@/lib/analytics/client";
import { presentShareLink, shareAnswer, type SharedAnswerLink } from "@/lib/chat/share-client";
import {
	SHARE_CARD_FORMATS,
	SHARE_CARD_STYLES,
	MAX_CARD_VERSES,
	canDrawCard,
	cardTranslation,
	parseStoredShareCardPrefs,
	shareCardFileName,
	shareCardPath,
	verseDoorUrl,
	type ShareCardPrefs,
	type ShareCardStyle,
	type ShareCardTarget,
} from "@/lib/share-cards/targets";

/**
 * The Share dialog for verses, Pick Up Your Cross and answers (docs/FEATURES.md,
 * "Share cards"). Mirrors mobile/src/features/shareCards/ShareCardSheet.tsx
 * (Android) and macos/Shared/Share/ShareCardSheet.swift (Apple).
 *
 * The preview is the server's own card at half size, so what the reader sees
 * is what they share. "Share image" hands the JPEG to the system sheet where
 * the browser can share files (phones, Safari, Edge); desktop Chrome and
 * Firefox cannot, so the same button downloads it there and says so. The
 * personal cross card goes out with the session cookie, same-origin.
 *
 * Mounted only while open, like the app's other dialogs.
 */

const PREFS_KEY = "sureword.shareCard.v1";

type PreviewState =
	| { status: "loading"; message?: string }
	| { status: "ready"; url: string }
	| { status: "error"; message: string };

async function cardError(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return typeof body?.error === "string" ? body.error : "The card didn't load. Check your connection and try again.";
}

async function fetchCard(path: string, signal?: AbortSignal): Promise<Blob> {
	const response = await fetch(path, { credentials: "same-origin", signal });
	if (!response.ok) throw new Error(await cardError(response));
	return response.blob();
}

type NoteState =
	| { status: "idle" | "loading" }
	| { status: "ready"; text: string; reference: string }
	| { status: "unavailable"; message: string };

/** The verse's line of encouragement; written once per passage server-side. */
async function fetchEncouragement(ref: string): Promise<{ text: string; reference: string }> {
	const response = await consentFetch("/api/cards/encouragement", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref }),
	});
	const body = (await response.json().catch(() => null)) as { text?: unknown; reference?: unknown; error?: unknown } | null;
	if (!response.ok || typeof body?.text !== "string" || typeof body.reference !== "string") {
		throw new Error(typeof body?.error === "string" ? body.error : "Encouragement isn't available right now.");
	}
	return { text: body.text, reference: body.reference };
}

function readPrefs(): ShareCardPrefs {
	try {
		return parseStoredShareCardPrefs(window.localStorage.getItem(PREFS_KEY));
	} catch {
		return parseStoredShareCardPrefs(null);
	}
}

/** Phones and Safari can share a file; desktop Chrome and Firefox cannot. */
function browserSharesFiles(): boolean {
	try {
		const probe = new File([new Blob()], "card.jpg", { type: "image/jpeg" });
		return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
	} catch {
		return false;
	}
}

export default function ShareCardDialog({
	target,
	shareText,
	linkText = "",
	onClose,
}: {
	target: ShareCardTarget;
	/** The plain-text form for Share as text. Unused for answers, which share a link. */
	shareText?: string;
	/** For an answer: the line that travels beside its link in a share sheet. */
	linkText?: string;
	onClose: () => void;
}) {
	const titleId = useId();
	const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const [{ style, format, encourage }, setChoice] = useState(readPrefs);
	const [note, setNote] = useState<NoteState>({ status: "idle" });
	const [link, setLink] = useState<SharedAnswerLink | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	const [busy, setBusy] = useState<"image" | "text" | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const previews = useRef(new Map<string, string>());
	// The full card for the chosen style, fetched as soon as its preview shows.
	// Safari only lets navigator.share run soon after the tap, and a full card
	// rendered after the tap can take longer than that.
	const fullCard = useRef<{ path: string; blob: Promise<Blob> } | null>(null);
	const sharesFiles = useMemo(browserSharesFiles, []);
	const timeZone = useMemo(() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			return undefined;
		}
	}, []);
	const drawable = canDrawCard(target);

	// Object URLs hold the previews in memory until the dialog goes.
	useEffect(() => {
		const cache = previews.current;
		return () => {
			for (const url of cache.values()) URL.revokeObjectURL(url);
		};
	}, []);

	const choose = useCallback(
		(next: Partial<ShareCardPrefs>) => {
			const choice = { style: next.style ?? style, format: next.format ?? format, encourage: next.encourage ?? encourage };
			setChoice(choice);
			setActionError(null);
			setNotice(null);
			try {
				window.localStorage.setItem(PREFS_KEY, JSON.stringify(choice));
			} catch {
				// A private window keeps today's choice only.
			}
		},
		[encourage, format, style]
	);

	// Ask for the verse's encouragement as the dialog opens. Any failure (AI
	// turned off, the model down) leaves a plain verse card.
	const wantsNote = target.kind === "verse" && drawable && encourage;
	useEffect(() => {
		if (!wantsNote || target.kind !== "verse" || note.status !== "idle") return;
		setNote({ status: "loading" });
		fetchEncouragement(target.reference)
			.then((result) => setNote({ status: "ready", ...result }))
			.catch((error: unknown) =>
				setNote({
					status: "unavailable",
					message: error instanceof Error ? error.message : "Encouragement isn't available right now.",
				})
			);
	}, [note.status, target, wantsNote]);
	const withNote = wantsNote && note.status === "ready";

	// An answer's card is drawn from its public snapshot, so the link is
	// minted as the dialog opens (idempotent per answer, as Share always was).
	const mintLink = useCallback(() => {
		if (target.kind !== "answer") return;
		setLinkError(null);
		shareAnswer(target.conversationId, target.messageId)
			.then(setLink)
			.catch((error: unknown) =>
				setLinkError(error instanceof Error ? error.message : "Could not create a link for this answer.")
			);
	}, [target]);

	useEffect(() => {
		mintLink();
	}, [mintLink]);

	const pathFor = useCallback(
		(nextStyle: ShareCardStyle, size: "full" | "preview") => {
			// The server's own spelling of the reference, so the card is one URL.
			const drawn = withNote && target.kind === "verse" && note.status === "ready" ? { ...target, reference: note.reference } : target;
			return shareCardPath(drawn, { style: nextStyle, format, size, timeZone, note: withNote }, link?.id);
		},
		[format, link?.id, note, target, timeZone, withNote]
	);

	const loadPreview = useCallback(async (path: string, signal?: AbortSignal): Promise<string> => {
		const cached = previews.current.get(path);
		if (cached) return cached;
		const url = URL.createObjectURL(await fetchCard(path, signal));
		previews.current.set(path, url);
		return url;
	}, []);

	useEffect(() => {
		if (!drawable) return;
		if (wantsNote && (note.status === "idle" || note.status === "loading")) {
			setPreview({ status: "loading", message: "Writing a word for this verse…" });
			return;
		}
		const path = pathFor(style, "preview");
		if (!path) {
			setPreview(linkError ? { status: "error", message: linkError } : { status: "loading" });
			return;
		}
		const controller = new AbortController();
		const cached = previews.current.get(path);
		setPreview(cached ? { status: "ready", url: cached } : { status: "loading" });
		loadPreview(path, controller.signal)
			.then((url) => {
				if (controller.signal.aborted) return;
				setPreview({ status: "ready", url });
				const full = pathFor(style, "full");
				if (full && fullCard.current?.path !== full) {
					const blob = fetchCard(full);
					blob.catch(() => {
						if (fullCard.current?.path === full) fullCard.current = null;
					});
					fullCard.current = { path: full, blob };
				}
				// Warm the other styles so switching is instant.
				for (const option of SHARE_CARD_STYLES) {
					const other = option.id === style ? null : pathFor(option.id, "preview");
					if (other) loadPreview(other, controller.signal).catch(() => {});
				}
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setPreview({ status: "error", message: error instanceof Error ? error.message : "The card didn't load." });
			});
		return () => controller.abort();
	}, [drawable, linkError, loadPreview, note.status, pathFor, reloadKey, style, wantsNote]);

	const retry = () => {
		for (const url of previews.current.values()) URL.revokeObjectURL(url);
		previews.current.clear();
		fullCard.current = null;
		if (target.kind === "answer" && !link) mintLink();
		setReloadKey((key) => key + 1);
	};

	const shareImage = async () => {
		const path = pathFor(style, "full");
		if (!path || busy) return;
		setBusy("image");
		setActionError(null);
		setNotice(null);
		try {
			const blob = await (fullCard.current?.path === path ? fullCard.current.blob : fetchCard(path));
			const name = shareCardFileName(target, style, format);
			const file = new File([blob], name, { type: "image/jpeg" });
			if (sharesFiles && navigator.canShare?.({ files: [file] })) {
				let shared = false;
				try {
					await navigator.share({ files: [file], title: "Shared from SureWord" });
					shared = true;
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") return;
					// NotAllowedError: the browser decided the tap was too long ago.
					// The download below still gets the card to the reader.
					if (!(error instanceof Error && error.name === "NotAllowedError")) throw error;
				}
				if (shared) {
					trackShareCard({ kind: target.kind, method: "image", style, format });
					onClose();
					return;
				}
			}
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
			trackShareCard({ kind: target.kind, method: "download", style, format });
			setNotice("Saved to your downloads.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "That card couldn't be shared. Try again.");
		} finally {
			setBusy(null);
		}
	};

	const shareWords = async () => {
		if (busy) return;
		setBusy("text");
		setActionError(null);
		setNotice(null);
		try {
			if (target.kind === "answer") {
				if (!link) return;
				const outcome = await presentShareLink({ title: "An answer from SureWord", text: linkText, url: link.url });
				if (outcome === "dismissed") return;
				trackShareCard({ kind: "answer", method: "link" });
				if (outcome === "copied") setNotice("Link copied.");
				else onClose();
				return;
			}
			if (!shareText) return;
			// The words travel with the door, so a text share brings people in too.
			const line = withNote && note.status === "ready" ? `\n\n${note.text}` : "";
			const door = verseDoorUrl(target.reference);
			const words = `${shareText}${line}${door ? `\n\n${door}` : ""}`;
			if (typeof navigator.share === "function") {
				try {
					await navigator.share({ text: words });
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") return;
					throw error;
				}
				trackShareCard({ kind: target.kind, method: "text" });
				onClose();
				return;
			}
			await navigator.clipboard.writeText(words);
			trackShareCard({ kind: target.kind, method: "text" });
			setNotice("Copied to the clipboard.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "That couldn't be shared. Try again.");
		} finally {
			setBusy(null);
		}
	};

	const aspect = SHARE_CARD_FORMATS.find((option) => option.id === format)?.aspectRatio ?? 1;
	const styleLabel = SHARE_CARD_STYLES.find((option) => option.id === style)?.label ?? "";
	const canShareWords = target.kind === "answer" ? link !== null : Boolean(shareText);
	const SecondaryIcon = target.kind === "answer" ? Link2 : Type;

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
			<div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto flex flex-col gap-4 glass-card border border-black/[0.1] dark:border-white/[0.1] rounded-t-2xl sm:rounded-2xl shadow-xl shadow-black/15 dark:shadow-black/60 p-5 outline-none"
			>
				<div className="flex items-center justify-between">
					<div id={titleId} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-semibold">
						<Share2 className="w-4 h-4" />
						Share
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
						aria-label="Close"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{drawable ? (
					<>
						<div
							className="mx-auto overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.04]"
							style={{ aspectRatio: String(aspect), height: "min(46vh, 30rem)", maxWidth: "100%" }}
							// An image only once it is one: role="img" hides its children
							// from screen readers, "Try again" included.
							role={preview.status === "ready" ? "img" : undefined}
							aria-label={preview.status === "ready" ? `Preview of the ${styleLabel} ${format} card` : undefined}
						>
							{preview.status === "ready" ? (
								// eslint-disable-next-line @next/next/no-img-element -- an object URL of the server's own card
								<img src={preview.url} alt="" className="h-full w-full object-cover" />
							) : preview.status === "error" ? (
								<div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
									<p className="text-sm text-neutral-600 dark:text-neutral-300">{preview.message}</p>
									<button
										type="button"
										onClick={retry}
										className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-400/[0.14]"
									>
										Try again
									</button>
								</div>
							) : (
								<div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
									<Loader2 className="h-5 w-5 animate-spin text-amber-500" />
									{preview.message ? (
										<p className="text-sm text-neutral-600 dark:text-neutral-300">{preview.message}</p>
									) : null}
								</div>
							)}
						</div>

						<div role="radiogroup" aria-label="Card style" className="flex flex-wrap justify-center gap-2">
							{SHARE_CARD_STYLES.map((option) => {
								const selected = option.id === style;
								return (
									<button
										key={option.id}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => choose({ style: option.id })}
										className={`flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors ${
											selected
												? "border-amber-500 bg-amber-400/[0.12] text-amber-700 dark:text-amber-400"
												: "border-black/[0.1] dark:border-white/[0.1] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
										}`}
									>
										<span
											aria-hidden
											className="h-4 w-4 rounded-full"
											style={{ background: `radial-gradient(circle at 50% 30%, ${option.swatch[0]}, ${option.swatch[1]} 70%)` }}
										/>
										{option.label}
									</button>
								);
							})}
						</div>

						<div role="radiogroup" aria-label="Card size" className="mx-auto flex rounded-full border border-black/[0.1] dark:border-white/[0.1] p-1">
							{SHARE_CARD_FORMATS.map((option) => {
								const selected = option.id === format;
								return (
									<button
										key={option.id}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => choose({ format: option.id })}
										className={`min-w-24 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
											selected ? "bg-amber-400/[0.14] text-amber-700 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"
										}`}
									>
										{option.label}
									</button>
								);
							})}
						</div>

						{target.kind === "verse" ? (
							<label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
								<span className="flex flex-col">
									<span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
										Add a word of encouragement
									</span>
									{encourage && note.status === "unavailable" ? (
										<span className="text-xs text-neutral-500 dark:text-neutral-400">{note.message}</span>
									) : null}
								</span>
								<input
									type="checkbox"
									role="switch"
									checked={encourage}
									onChange={(event) => {
										choose({ encourage: event.target.checked });
										if (event.target.checked && note.status === "unavailable") setNote({ status: "idle" });
									}}
									className="h-5 w-9 cursor-pointer appearance-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 bg-neutral-300 transition-colors before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:transition-transform checked:bg-amber-500 checked:before:translate-x-[18px] dark:bg-neutral-700 dark:checked:bg-amber-500"
								/>
							</label>
						) : null}

						<button
							type="button"
							onClick={() => void shareImage()}
							disabled={busy !== null || preview.status !== "ready"}
							className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-300 transition-colors disabled:opacity-50"
						>
							{busy === "image" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : sharesFiles ? (
								<Share2 className="h-4 w-4" />
							) : (
								<Download className="h-4 w-4" />
							)}
							{sharesFiles ? "Share image" : "Download image"}
						</button>
					</>
				) : (
					<p className="py-2 text-center text-sm text-neutral-600 dark:text-neutral-300">
						{target.kind === "verse" && cardTranslation(target.translation)
							? `A card holds up to ${MAX_CARD_VERSES} verses. This passage shares as text.`
							: "Cards are drawn in the KJV, BSB and NKJV. This passage shares as text."}
					</p>
				)}

				<button
					type="button"
					onClick={() => void shareWords()}
					disabled={busy !== null || !canShareWords}
					className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/[0.1] dark:border-white/[0.1] px-4 text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
				>
					{busy === "text" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SecondaryIcon className="h-4 w-4" />}
					{target.kind === "answer" ? "Share link" : "Share as text"}
				</button>

				{notice ? (
					<p className="flex items-center justify-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400" role="status">
						<Check className="h-4 w-4" />
						{notice}
					</p>
				) : null}
				{actionError ? (
					<p className="text-center text-sm text-red-600 dark:text-red-400" role="alert">
						{actionError}
					</p>
				) : null}
			</div>
		</div>,
		document.body
	);
}
