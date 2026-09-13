"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { parseCard } from "./learn";

export interface AddLearnProps {
	book: number;
	chapter: number;
	verse: number;
	translation: "KJV" | "NKJV";
	source: "sheet" | "highlight" | "suggestion";
	/** Set where the surrounding text alone does not name the verse being added. */
	accessibilityLabel?: string;
	onAdded?: () => void;
}

export function AddLearnButton(props: AddLearnProps) {
	const { user } = useUser();
	if (!user) return null;
	return <LearnAction key={`${user.id}:${props.book}:${props.chapter}:${props.verse}:${props.translation}`} {...props} />;
}

function LearnAction({ onAdded, accessibilityLabel, ...verse }: AddLearnProps) {
	const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const request = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const onAddedRef = useRef(onAdded);
	onAddedRef.current = onAdded;
	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; request.current?.abort(); };
	}, []);
	const add = async () => {
		if (request.current || status === "saved") return;
		const controller = new AbortController();
		request.current = controller;
		setStatus("saving");
		const timeout = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch("/api/learn", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify(verse), signal: controller.signal,
			});
			if (!response.ok) throw new Error("Add failed");
			const card = parseCard(await response.json());
			if (card.book !== verse.book || card.chapter !== verse.chapter || card.verse !== verse.verse) throw new Error("Unexpected verse");
			if (mounted.current) setStatus("saved");
		} catch {
			if (mounted.current) setStatus("error");
		} finally {
			clearTimeout(timeout);
			request.current = null;
		}
	};
	useEffect(() => { if (status === "saved") onAddedRef.current?.(); }, [status]);
	return <div className="my-2">
		{status === "saved" ? <p role="status" className="text-sm text-neutral-600 dark:text-neutral-300">Added to Learn. <Link href="/bible/learn" className="inline-block min-h-11 py-3 font-semibold text-amber-700 dark:text-amber-400">Open Learn</Link></p> :
			<button type="button" aria-label={accessibilityLabel} disabled={status === "saving"} onClick={() => void add()} className="min-h-11 w-full rounded-xl border border-amber-600/25 px-3 py-2.5 text-sm font-semibold text-amber-700 disabled:opacity-50 dark:text-amber-400">{status === "saving" ? "Adding..." : "Learn this verse"}</button>}
		{status === "error" && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">Could not add this verse. Check your connection and try again.</p>}
	</div>;
}
