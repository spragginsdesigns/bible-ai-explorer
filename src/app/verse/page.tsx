import { redirect } from "next/navigation";
import { resolveReference } from "@/lib/bible/books";
import { stripTranslationTag } from "@/utils/verseParser";

/**
 * `/verse?ref=John%203:16` opens that verse in the reader, the web twin of
 * Android's `sureword://verse?ref=` deep link (mobile/app/verse.tsx). It is
 * not listed in the middleware's public routes, so it asks for a session
 * exactly as every /bible page does. An unparseable reference goes home.
 */
export default async function VerseDeepLinkPage({
	searchParams,
}: {
	searchParams: Promise<{ ref?: string | string[] }>;
}) {
	const { ref } = await searchParams;
	const reference = typeof ref === "string" ? ref.trim() : "";
	const target = reference ? resolveReference(stripTranslationTag(reference)) : null;
	if (!target) redirect("/");
	const query = new URLSearchParams({
		book: String(target.order),
		chapter: String(target.chapter),
	});
	if (target.verse) query.set("verse", String(target.verse));
	redirect(`/bible/chapter?${query.toString()}`);
}
