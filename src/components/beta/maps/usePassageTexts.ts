"use client";

import { useEffect, useState } from "react";
import { loadPassageText, type PassageText } from "@/lib/beta/maps/passages";

export type PassageState = { status: "loading" } | { status: "ready"; text: PassageText } | { status: "error" };

/** The bundled KJV text of each passage, loaded on demand in the browser. */
export function usePassageTexts(refs: readonly string[], maxVerses?: number): Record<string, PassageState> {
	const key = refs.join("|");
	const [states, setStates] = useState<Record<string, PassageState>>({});
	useEffect(() => {
		let live = true;
		const list = key ? key.split("|") : [];
		setStates(Object.fromEntries(list.map((ref) => [ref, { status: "loading" } as PassageState])));
		for (const ref of list) {
			loadPassageText(ref, maxVerses)
				.then((text) => {
					if (live) setStates((current) => ({ ...current, [ref]: text ? { status: "ready", text } : { status: "error" } }));
				})
				.catch(() => {
					if (live) setStates((current) => ({ ...current, [ref]: { status: "error" } }));
				});
		}
		return () => {
			live = false;
		};
	}, [key, maxVerses]);
	return states;
}
