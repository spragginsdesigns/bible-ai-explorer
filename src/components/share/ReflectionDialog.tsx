"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@clerk/nextjs";
import { X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { consentFetch } from "@/lib/ai-consent-gate";
import { presentShareLink } from "@/lib/chat/share-client";
import { SHARE_CARD_STYLES, SHARE_CARD_FORMATS, personalPreviewPath, type ShareCardStyle, type ShareCardFormat } from "@/lib/share-cards/targets";
import { MAX_REFLECTION_LENGTH, REFLECTION_FONTS, REFLECTION_PLACEMENTS, DEFAULT_REFLECTION_PRESENTATION, type ReflectionPresentation } from "@/lib/share-cards/reflection-contract";

type Draft = { id: string; reference: string; translation: string; text: string };
async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
	const response = await consentFetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
	const data = await response.json();
	if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "That didn't work. Try again.");
	return data as T;
}
async function card(path: string): Promise<Blob> {
	const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
	if (!response.ok) throw new Error("The card didn't load. Try again.");
	return response.blob();
}

export default function ReflectionDialog({ reference, translation, onClose, initialStyle, initialFormat }: { reference: string; translation: string; onClose: () => void; initialStyle: ShareCardStyle; initialFormat: ShareCardFormat }) {
	const titleId = useId();
	const panel = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const { user } = useUser();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [text, setText] = useState("");
	const [signature, setSignature] = useState(user?.firstName ?? "");
	const [presentation, setPresentation] = useState<ReflectionPresentation>(DEFAULT_REFLECTION_PRESENTATION);
	const [style, setStyle] = useState<ShareCardStyle>(initialStyle);
	const [format, setFormat] = useState<ShareCardFormat>(initialFormat);
	const [busy, setBusy] = useState<string | null>("opening");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
	const [publishedURL, setPublishedURL] = useState<string | null>(null);
	const active = useRef(true);
	const urls = useRef<string[]>([]);
	const fullCard = useRef<Blob | null>(null);
	const key = JSON.stringify({ text: text.trim(), signature: signature.trim(), presentation, style, format });
	const currentKey = useRef(key); currentKey.current = key;
	const ready = preview?.key === key;
	const locked = busy !== null || publishedURL !== null;

	useEffect(() => {
		active.current = true;
		void request<Draft>("/api/cards/reflection", "POST", { reference, translation })
			.then(value => { if (active.current) setDraft(value); })
			.catch(() => { if (active.current) setError("The reflection couldn't be opened. Close it and try again."); })
			.finally(() => { if (active.current) setBusy(null); });
		const heldURLs = urls.current;
		return () => { active.current = false; heldURLs.forEach(url => URL.revokeObjectURL(url)); };
	}, [reference, translation]);

	const fail = (reason: unknown) => { if (active.current) setError(reason instanceof Error ? reason.message : "That didn't work. Try again."); };
	const suggest = async () => {
		if (!draft || locked) return;
		setBusy("writing"); setError(null); setNotice(null);
		try {
			const result = await request<{ text: string }>(`/api/cards/reflection/${draft.id}/suggest`, "POST");
			if (active.current) { setText(result.text); setPreview(null); }
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const updatePreview = async () => {
		if (!draft || locked || !text.trim()) return;
		const requestedKey = key;
		setBusy("preview"); setError(null); setNotice(null); setPreview(null); fullCard.current = null;
		try {
			const result = await request<{ fits: boolean }>(`/api/cards/personal/${draft.id}`, "PATCH", { personalLine: text.trim(), signature: signature.trim(), presentation });
			if (!result.fits) throw new Error("Shorten your reflection or choose fewer verses so every word fits.");
			const edit = Date.now();
			const [small, full] = await Promise.all([
				card(personalPreviewPath(draft.id, { style, format, size: "preview" }, edit)),
				card(personalPreviewPath(draft.id, { style, format, size: "full" }, edit)),
			]);
			if (!active.current || requestedKey !== currentKey.current) return;
			const url = URL.createObjectURL(small); urls.current.push(url);
			fullCard.current = full; setPreview({ key: requestedKey, url });
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const share = async (method: "image" | "link") => {
		if (!draft || busy || !ready || !fullCard.current) return;
		setBusy(method); setError(null); setNotice(null);
		try {
			let url = publishedURL;
			if (!url) {
				const published = await request<{ url: string }>("/api/cards/personal", "POST", { draftId: draft.id, personalLine: text.trim(), signature: signature.trim(), presentation });
				url = published.url;
				if (active.current) setPublishedURL(url);
			}
			if (!active.current) return;
			if (method === "link") {
				const result = await presentShareLink({ title: `My reflection on ${reference}`, text: text.trim(), url });
				if (result === "copied") setNotice("Link copied.");
			} else {
				const file = new File([fullCard.current], "SureWord My reflection.jpg", { type: "image/jpeg" });
				if (navigator.canShare?.({ files: [file] })) {
					try { await navigator.share({ files: [file], title: "My reflection" }); return; }
					catch (reason) { if (reason instanceof Error && reason.name === "AbortError") return;
						if (!(reason instanceof Error && reason.name === "NotAllowedError")) throw reason; }
				}
				const download = URL.createObjectURL(file); urls.current.push(download);
				const anchor = document.createElement("a"); anchor.href = download; anchor.download = file.name;
				document.body.appendChild(anchor); anchor.click(); anchor.remove(); setNotice("Saved to your downloads.");
			}
		} catch (reason) { fail(reason); }
		finally { if (active.current) setBusy(null); }
	};
	const choices = <T extends string,>(items: readonly { id: T; label: string }[], value: T, label: string, choose: (id: T) => void) =>
		<fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm font-semibold">{label}</legend>
			{items.map(item => <button type="button" key={item.id} disabled={locked} aria-pressed={value === item.id} onClick={() => choose(item.id)}
				className={`min-h-11 rounded-full border px-4 text-sm disabled:opacity-50 ${value === item.id ? "border-amber-600 bg-amber-400/10 text-amber-700 dark:text-amber-300" : "border-black/15 dark:border-white/15"}`}>{item.label}</button>)}
		</fieldset>;
	const inputClass = "w-full rounded-xl border border-black/15 dark:border-white/15 bg-transparent p-3 text-base disabled:opacity-60 focus:outline-amber-500";
	const buttonClass = "min-h-11 rounded-xl border border-amber-600/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300 disabled:opacity-40";
	return createPortal(<div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
		<div className="absolute inset-0 bg-black/80" onClick={onClose} />
		<div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
			className="relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-black/10 bg-background text-foreground shadow-xl outline-none dark:border-white/10 sm:max-w-lg sm:rounded-2xl">
			<header className="flex items-center justify-between border-b border-black/10 p-4 dark:border-white/10">
				<h2 id={titleId} className="font-semibold">My reflection</h2>
				<button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center"><X size={20} /></button>
			</header>
			<div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
				<p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{draft?.reference ?? reference} · {translation}</p>
				<p className="text-sm">Share how this verse speaks to your walk with God. Only the words you approve are shared.</p>
				<label className="text-sm font-semibold">My reflection
					<textarea aria-label="My reflection" value={text} onChange={event => setText(event.target.value)} maxLength={MAX_REFLECTION_LENGTH} disabled={locked}
						placeholder="What does this verse mean in your walk?" rows={4} className={`${inputClass} mt-2 resize-y font-normal`} />
				</label>
				<p className="text-xs">{text.length}/{MAX_REFLECTION_LENGTH}</p>
				<button type="button" className={buttonClass} disabled={!draft || locked} onClick={() => void suggest()}>{busy === "writing" ? "Considering your walk…" : "Draft from my walk"}</button>
				<p className="text-xs">Uses your study to suggest a reflection without private details. Review and edit every word before sharing.</p>
				<label className="text-sm font-semibold">Your name (optional)<input aria-label="Name on reflection, optional" value={signature} maxLength={30} disabled={locked}
					onChange={event => setSignature(event.target.value)} className={`${inputClass} mt-2 font-normal`} /></label>
				{choices(REFLECTION_FONTS, presentation.font, "Reflection font", font => setPresentation({ ...presentation, font }))}
				{choices(REFLECTION_PLACEMENTS, presentation.placement, "Reflection placement", placement => setPresentation({ ...presentation, placement }))}
				{choices(SHARE_CARD_STYLES, style, "Card style", setStyle)}
				{choices(SHARE_CARD_FORMATS, format, "Card size", setFormat)}
				{ready && preview ? <div className="flex justify-center">{/* eslint-disable-next-line @next/next/no-img-element -- authenticated server-rendered preview */}
					<img src={preview.url} alt={`Your reflection: ${text}`} className="max-h-80 max-w-full rounded-xl object-contain" /></div> : null}
				{publishedURL ? <p className="text-xs">This shared version is fixed. Close and reopen to write a new reflection.</p> : null}
			</div>
			<footer className="flex flex-col gap-2 border-t border-black/10 p-4 dark:border-white/10">
				{error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
				{notice ? <p role="status" className="text-sm">{notice}</p> : null}
				{ready ? <div className="flex gap-2"><button type="button" className={`${buttonClass} flex-1`} disabled={busy !== null} onClick={() => void share("image")}>{busy === "image" ? "Preparing…" : "Share image"}</button>
					<button type="button" className={`${buttonClass} flex-1`} disabled={busy !== null} onClick={() => void share("link")}>{busy === "link" ? "Preparing…" : "Share link"}</button></div>
					: <button type="button" className={buttonClass} disabled={!draft || !text.trim() || locked} onClick={() => void updatePreview()}>{busy === "preview" ? "Preparing preview…" : "Preview my card"}</button>}
			</footer>
		</div>
	</div>, document.body);
}
