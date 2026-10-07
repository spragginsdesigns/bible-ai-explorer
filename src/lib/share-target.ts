/**
 * Something shared into SureWord from another app (the installed web app's
 * share target, `/share?title=&text=&url=`): a friend's message, a link, a
 * claim to weigh. Pure, so the logic suite pins it.
 */

/** Long enough for a pasted message thread, short enough for a URL. */
export const MAX_SHARED_TEXT_LENGTH = 4000;

function clean(value: string | string[] | undefined): string {
	const text = Array.isArray(value) ? value[0] : value;
	return (text ?? "").replace(/\r\n?/g, "\n").trim();
}

/**
 * One block of text from the three share fields. Apps fill them inconsistently
 * (Android often repeats the link inside `text`, and the title is frequently
 * the app's own name), so each part is kept only when it adds something.
 */
export function combineSharedText(fields: {
	title?: string | string[];
	text?: string | string[];
	url?: string | string[];
}): string {
	const title = clean(fields.title);
	const text = clean(fields.text);
	const url = clean(fields.url);
	const parts: string[] = [];
	if (title && !text.includes(title)) parts.push(title);
	if (text) parts.push(text);
	if (url && !text.includes(url)) parts.push(url);
	return parts.join("\n\n").slice(0, MAX_SHARED_TEXT_LENGTH);
}

export type ShareAction = "check" | "reply";

/** The chat link that prefills the command and the shared text; the user sends it. */
export function shareActionHref(action: ShareAction, sharedText: string): string {
	const prompt = sharedText ? `/${action} ${sharedText}` : `/${action} `;
	return `/?prompt=${encodeURIComponent(prompt)}`;
}
