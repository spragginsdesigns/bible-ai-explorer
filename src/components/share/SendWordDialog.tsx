"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@clerk/nextjs";
import { Check, Download, Link2, Loader2, RefreshCw, Send, Share2, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { consentFetch } from "@/lib/ai-consent-gate";
import { trackShareCard } from "@/lib/analytics/client";
import {
	SHARE_CARD_FORMATS,
	SHARE_CARD_STYLES,
	parseStoredShareCardPrefs,
	personalPreviewPath,
	type ShareCardPrefs,
} from "@/lib/share-cards/targets";

/**
 * Send a word to someone (docs/FEATURES.md, "Share cards" -> "Send a word").
 * Mirrors mobile/src/features/shareCards/SendWordSheet.tsx (Android) and the
 * Apple sheet.
 *
 * The sender names who it is for and what they face; SureWord picks a KJV
 * passage (or uses the one passed in) and writes a word for them by name as a
 * private draft. The sender adds their own line and name, sees the card as it
 * will be shared, can ask for another word, then shares the image or the
 * link. Sharing sends the card and freezes it, so the sender's fields lock
 * from then on. The situation lives only in this dialog: the server uses it
 * to choose and write, and never stores it.
 *
 * Safari only lets navigator.share run soon after the tap, so the full card
 * is fetched as soon as its preview shows, and both shares start at once
 * while the card is sent alongside (its link is known in advance). That is
 * safe because Share waits until the server holds exactly the words on
 * screen, the card fits, and any line has a name under it: nothing about the
 * content can make the send fail, and a send lost to the network is retried
 * on the same id, which makes the link already shared work.
 */

const PREFS_KEY = "sureword.shareCard.v1";
const EDIT_SAVE_DELAY_MS = 700;

interface Draft {
	id: string;
	reference: string;
	word: string;
	/** The name the card was written for; the field may change after. */
	recipient: string;
}

async function readError(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return typeof body?.error === "string" ? body.error : fallback;
}

function readPrefs(): ShareCardPrefs {
	try {
		return parseStoredShareCardPrefs(window.localStorage.getItem(PREFS_KEY));
	} catch {
		return parseStoredShareCardPrefs(null);
	}
}

function browserSharesFiles(): boolean {
	try {
		const probe = new File([new Blob()], "card.jpg", { type: "image/jpeg" });
		return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
	} catch {
		return false;
	}
}

function patchDraft(id: string, body: { personalLine: string; signature: string }): Promise<Response> {
	return fetch(`/api/cards/personal/${id}`, {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

export default function SendWordDialog({
	reference,
	onClose,
}: {
	/** A passage the sender already chose; otherwise SureWord finds one. Drafts are KJV. */
	reference?: string | null;
	onClose: () => void;
}) {
	const titleId = useId();
	const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const { user } = useUser();
	const [recipient, setRecipient] = useState("");
	const [situation, setSituation] = useState("");
	const [personalLine, setPersonalLine] = useState("");
	const [signature, setSignature] = useState(user?.firstName ?? "");
	const [prefs, setPrefs] = useState(readPrefs);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [fits, setFits] = useState(true);
	const [sentId, setSentId] = useState<string | null>(null);
	const [writing, setWriting] = useState(false);
	const [edit, setEdit] = useState(0);
	const [preview, setPreview] = useState<{ status: "loading" } | { status: "ready"; url: string } | { status: "error"; message: string }>({ status: "loading" });
	const [busy, setBusy] = useState<"image" | "link" | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const saved = useRef({ personalLine: "", signature: "" });
	const fullCard = useRef<{ key: string; blob: Promise<Blob> } | null>(null);
	const [sharesFiles, setSharesFiles] = useState(false);
	const sent = draft !== null && sentId === draft.id;

	useEffect(() => {
		setSharesFiles(browserSharesFiles());
	}, []);

	// Clerk may load the name after the first render.
	useEffect(() => {
		if (user?.firstName) setSignature((current) => current || user.firstName || "");
	}, [user?.firstName]);

	const choose = (next: Partial<ShareCardPrefs>) => {
		const value = { ...prefs, ...next };
		setPrefs(value);
		try {
			window.localStorage.setItem(PREFS_KEY, JSON.stringify(value));
		} catch {
			// A private window keeps today's choice only.
		}
	};

	const write = async () => {
		if (writing) return;
		setWriting(true);
		setError(null);
		setNotice(null);
		try {
			const response = await consentFetch("/api/cards/word", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					recipient,
					situation,
					...(reference ? { reference } : {}),
					// "Write another word" deletes the draft it replaces.
					...(draft && !sent ? { replaces: draft.id } : {}),
				}),
			});
			if (!response.ok) throw new Error(await readError(response, "SureWord couldn't write that word just now."));
			const result = (await response.json()) as Omit<Draft, "recipient"> & { fits: boolean };
			let fitsNow = result.fits;
			if (personalLine.trim() || signature.trim()) {
				const patched = await patchDraft(result.id, { personalLine, signature });
				if (!patched.ok) throw new Error(await readError(patched, "Your words couldn't be saved."));
				fitsNow = ((await patched.json()) as { fits: boolean }).fits;
			}
			saved.current = { personalLine, signature };
			setSentId(null);
			setFits(fitsNow);
			setDraft({ id: result.id, reference: result.reference, word: result.word, recipient: recipient.trim() });
			setEdit((value) => value + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : "SureWord couldn't write that word just now.");
		} finally {
			setWriting(false);
		}
	};

	// The sender's own words, saved to the draft as they type. A sent card is
	// frozen, so saving stops there.
	const draftId = draft?.id ?? null;
	useEffect(() => {
		if (!draftId || sent) return;
		if (saved.current.personalLine === personalLine && saved.current.signature === signature) return;
		const timer = setTimeout(() => {
			const next = { personalLine, signature };
			patchDraft(draftId, next)
				.then(async (response) => {
					if (!response.ok) {
						setError(await readError(response, "Your words couldn't be saved."));
						return;
					}
					saved.current = next;
					setFits(((await response.json()) as { fits: boolean }).fits);
					setError(null);
					setEdit((value) => value + 1);
				})
				.catch(() => setError("Your words couldn't be saved."));
		}, EDIT_SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [draftId, personalLine, sent, signature]);

	useEffect(() => {
		if (!draftId) return;
		const controller = new AbortController();
		let url: string | null = null;
		setPreview({ status: "loading" });
		const size = { style: prefs.style, format: prefs.format };
		fetch(personalPreviewPath(draftId, { ...size, size: "preview" }, edit), { credentials: "same-origin", signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(await readError(response, "The card didn't load."));
				const blob = await response.blob();
				if (controller.signal.aborted) return;
				url = URL.createObjectURL(blob);
				setPreview({ status: "ready", url });
				// The card that Share image will send, ready before the tap.
				const key = `${draftId}:${prefs.style}:${prefs.format}:${edit}`;
				if (fullCard.current?.key !== key) {
					const full = fetch(personalPreviewPath(draftId, { ...size, size: "full" }, edit), { credentials: "same-origin" }).then(
						async (fullResponse) => {
							if (!fullResponse.ok) throw new Error(await readError(fullResponse, "The card didn't load."));
							return fullResponse.blob();
						}
					);
					full.catch(() => {
						if (fullCard.current?.key === key) fullCard.current = null;
					});
					fullCard.current = { key, blob: full };
				}
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) {
					setPreview({ status: "error", message: err instanceof Error ? err.message : "The card didn't load." });
				}
			});
		return () => {
			controller.abort();
			if (url) URL.revokeObjectURL(url);
		};
	}, [draftId, edit, prefs.format, prefs.style]);

	/**
	 * Send the card: one conditional write on the server, so repeats change
	 * nothing. It sends the saved words, which Share waits for, so the card
	 * sent is the card that was shown.
	 */
	const publish = async (id: string): Promise<void> => {
		const response = await fetch("/api/cards/personal", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ draftId: id, ...saved.current }),
		}).catch(() => null);
		if (!response?.ok) {
			// The link may already be on its way; sending again on the same id
			// is what makes it open.
			const reason = response ? await readError(response, "") : "";
			throw new Error(reason || "That card couldn't be sent, so its link won't open yet. Tap Share again to send it.");
		}
		setSentId(id);
	};

	const shareImage = async () => {
		if (!draft || busy) return;
		setBusy("image");
		setError(null);
		setNotice(null);
		const sending = publish(draft.id);
		try {
			const key = `${draft.id}:${prefs.style}:${prefs.format}:${edit}`;
			// The owner's own copy, which needs no published card: the public
			// one may not exist yet while the send is still in flight.
			const blob = await (fullCard.current?.key === key
				? fullCard.current.blob
				: fetch(personalPreviewPath(draft.id, { style: prefs.style, format: prefs.format, size: "full" }, edit), {
						credentials: "same-origin",
					}).then((response) => response.blob()));
			const name = `SureWord for ${draft.recipient.replace(/[^A-Za-z0-9 ]+/g, "").trim() || "you"}.jpg`;
			const file = new File([blob], name, { type: "image/jpeg" });
			if (sharesFiles && navigator.canShare?.({ files: [file] })) {
				try {
					await navigator.share({ files: [file], title: `A word for ${draft.recipient}` });
					await sending;
					trackShareCard({ kind: "word", method: "image", style: prefs.style, format: prefs.format });
					onClose();
					return;
				} catch (err) {
					if (err instanceof Error && err.name === "AbortError") {
						await sending.catch(() => {});
						return;
					}
					if (!(err instanceof Error && err.name === "NotAllowedError")) throw err;
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
			await sending;
			trackShareCard({ kind: "word", method: "download", style: prefs.style, format: prefs.format });
			setNotice("Saved to your downloads.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "That card couldn't be shared.");
		} finally {
			sending.catch(() => {});
			setBusy(null);
		}
	};

	const shareLink = async () => {
		if (!draft || busy) return;
		setBusy("link");
		setError(null);
		setNotice(null);
		const url = `https://sureword.app/c/${draft.id}`;
		const text = `A word for ${draft.recipient}`;
		const sending = publish(draft.id);
		try {
			if (typeof navigator.share === "function") {
				try {
					await navigator.share({ title: text, text, url });
					await sending;
					trackShareCard({ kind: "word", method: "link" });
					onClose();
					return;
				} catch (err) {
					if (err instanceof Error && err.name === "AbortError") {
						await sending.catch(() => {});
						return;
					}
				}
			}
			await navigator.clipboard.writeText(url);
			await sending;
			trackShareCard({ kind: "word", method: "link" });
			setNotice("Link copied.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "That link couldn't be shared.");
		} finally {
			sending.catch(() => {});
			setBusy(null);
		}
	};

	const aspect = SHARE_CARD_FORMATS.find((option) => option.id === prefs.format)?.aspectRatio ?? 1;
	const canWrite = recipient.trim().length > 0 && situation.trim().length > 0 && !writing;
	// A line needs the sender's name under it; the server refuses one without.
	const needsName = personalLine.trim().length > 0 && signature.trim().length === 0;
	// The server holds exactly what is on screen (no save still pending).
	const settled = saved.current.personalLine === personalLine && saved.current.signature === signature;
	const canShare = draft !== null && busy === null && !writing && fits && !needsName && settled;
	// From the moment a share starts, what is on the card is what was there.
	const wordsLocked = sent || busy !== null;
	const field =
		"w-full rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-transparent px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-55";
	const chip = (selected: boolean) =>
		`min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors ${
			selected
				? "border-amber-500 bg-amber-400/[0.12] text-amber-700 dark:text-amber-400"
				: "border-black/[0.1] dark:border-white/[0.1] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
		}`;

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
			<div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto flex flex-col gap-3 glass-card border border-black/[0.1] dark:border-white/[0.1] rounded-t-2xl sm:rounded-2xl shadow-xl shadow-black/15 dark:shadow-black/60 p-5 outline-none"
			>
				<div className="flex items-center justify-between">
					<div id={titleId} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-semibold">
						<Send className="w-4 h-4" />
						Send a word
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
						aria-label="Close"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{draft ? (
					<>
						<div
							className="mx-auto overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.04]"
							style={{ aspectRatio: String(aspect), height: "min(40vh, 26rem)", maxWidth: "100%" }}
						>
							{preview.status === "ready" ? (
								// eslint-disable-next-line @next/next/no-img-element -- an object URL of the server's own card
								<img src={preview.url} alt={`Card for ${draft.recipient}: ${draft.reference}. ${draft.word}`} className="h-full w-full object-cover" />
							) : preview.status === "error" ? (
								<p className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-600 dark:text-neutral-300">{preview.message}</p>
							) : (
								<div className="flex h-full items-center justify-center">
									<Loader2 className="h-5 w-5 animate-spin text-amber-500" />
								</div>
							)}
						</div>
						<div role="radiogroup" aria-label="Card style" className="flex flex-wrap justify-center gap-2">
							{SHARE_CARD_STYLES.map((option) => (
								<button key={option.id} type="button" role="radio" aria-checked={option.id === prefs.style} onClick={() => choose({ style: option.id })} className={chip(option.id === prefs.style)}>
									{option.label}
								</button>
							))}
						</div>
						<div role="radiogroup" aria-label="Card size" className="flex justify-center gap-2">
							{SHARE_CARD_FORMATS.map((option) => (
								<button key={option.id} type="button" role="radio" aria-checked={option.id === prefs.format} onClick={() => choose({ format: option.id })} className={chip(option.id === prefs.format)}>
									{option.label}
								</button>
							))}
						</div>
					</>
				) : (
					<p className="text-sm text-neutral-600 dark:text-neutral-300">
						{reference
							? `SureWord will write a word for them under ${reference}, in the KJV.`
							: "SureWord will find a verse for them and write a word to go with it."}
					</p>
				)}

				<label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
					Who is it for?
					<input className={field} value={recipient} maxLength={40} onChange={(event) => setRecipient(event.target.value)} placeholder="Their first name" />
				</label>
				<label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
					What are they facing?
					<textarea className={`${field} min-h-20`} value={situation} maxLength={300} onChange={(event) => setSituation(event.target.value)} placeholder="Surgery tomorrow, a hard week, a new job..." />
				</label>
				<p className="text-xs text-neutral-500 dark:text-neutral-400">Only used to choose the verse and the words. Never saved or shown.</p>
				{draft ? (
					<button
						type="button"
						onClick={() => void write()}
						disabled={!canWrite || busy !== null}
						className="inline-flex min-h-10 items-center justify-center gap-2 self-center rounded-full px-4 text-sm font-semibold text-amber-700 hover:bg-amber-400/10 disabled:opacity-50 dark:text-amber-400"
					>
						{writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
						Write another word
					</button>
				) : null}

				<label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
					Your own words (optional)
					<textarea className={`${field} min-h-14`} value={personalLine} maxLength={120} disabled={wordsLocked} onChange={(event) => setPersonalLine(event.target.value)} placeholder="Praying for you today." />
				</label>
				<label className="flex flex-col gap-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
					From
					<input className={field} value={signature} maxLength={30} disabled={wordsLocked} onChange={(event) => setSignature(event.target.value)} placeholder="Your first name" />
				</label>
				{sent ? <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">Sent. Write another word to change it.</p> : null}
				{draft && needsName ? <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">Add your name under your words.</p> : null}
				{draft && !fits ? (
					<p className="text-center text-xs text-neutral-500 dark:text-neutral-400">That&apos;s a little long for the card. Shorten your words.</p>
				) : null}

				{!draft ? (
					<button
						type="button"
						onClick={() => void write()}
						disabled={!canWrite}
						className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-50"
					>
						{writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
						{writing ? `Finding a word for ${recipient.trim() || "them"}…` : "Write their card"}
					</button>
				) : (
					<>
						<button
							type="button"
							onClick={() => void shareImage()}
							disabled={!canShare || preview.status !== "ready"}
							className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-50"
						>
							{busy === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : sharesFiles ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
							{sharesFiles ? "Share image" : "Download image"}
						</button>
						<button
							type="button"
							onClick={() => void shareLink()}
							disabled={!canShare}
							className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/[0.1] dark:border-white/[0.1] px-4 text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-50"
						>
							{busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
							Share link
						</button>
					</>
				)}
				{notice ? (
					<p className="flex items-center justify-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400" role="status">
						<Check className="h-4 w-4" />
						{notice}
					</p>
				) : null}
				{error ? (
					<p className="text-center text-sm text-red-600 dark:text-red-400" role="alert">
						{error}
					</p>
				) : null}
			</div>
		</div>,
		document.body
	);
}
