import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { resolveVerseReference } from "@/features/chat/verseLinks";

/** `sureword://verse?ref=John%203:16` uses the same reader path as chat links. */
export default function VerseDeepLink() {
	const { ref } = useLocalSearchParams<{ ref?: string | string[] }>();
	const reference = typeof ref === "string" ? ref.trim() : "";
	const target = reference ? resolveVerseReference(reference) : null;
	if (!target) return <Redirect href="/" />;
	return <Redirect href={{
		pathname: "/bible/chapter",
		params: {
			book: String(target.order),
			chapter: String(target.chapter),
			...(target.verse ? { verse: String(target.verse) } : {}),
		},
	}} withAnchor />;
}
