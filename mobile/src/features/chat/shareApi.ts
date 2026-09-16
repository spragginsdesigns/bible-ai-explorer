import { Share } from "react-native";
import { apiJson, type GetToken } from "@/lib/api";

/**
 * Share an answer (docs/FEATURES.md, "Share an answer: a public page, and a
 * card image").
 *
 * The server stores a SNAPSHOT of the answer under a random 16-character id and
 * serves it signed-out at `https://sureword.app/shared/{id}`. Nothing here ever
 * sends the conversation itself: the client hands over a conversation id and a
 * message id, and gets back one capability URL.
 *
 * Minting is idempotent on the message, so a second tap on an already-shared
 * answer reuses the link rather than creating a second public page for it. That
 * is why the button never needs to remember whether it has been tapped before.
 */

/** What POST /api/shared answers with. */
export interface SharedAnswerLink {
	id: string;
	url: string;
	createdAt: string;
}

/** One row of GET /api/shared, for Settings -> Shared answers. */
export interface SharedAnswerSummary {
	id: string;
	url: string;
	question: string;
	createdAt: string;
	revokedAt: string | null;
}

/**
 * The title Android puts on the chooser. Deliberately not the question: the
 * chooser is read before the link is sent, and the question is the one part of
 * a shared answer the sender may not want on their own screen in public.
 */
export const SHARE_DIALOG_TITLE = "An answer from SureWord";

/**
 * The share-sheet payload for a minted link, kept pure so the contract can be
 * asserted without a device. `message` is what Android's chooser actually
 * passes to most targets; `url` is carried too because the platform sheets that
 * do read it render a link preview instead of raw text.
 */
export function shareSheetPayload(url: string): {
	title: string;
	message: string;
	url: string;
} {
	return { title: SHARE_DIALOG_TITLE, message: url, url };
}

/** Mint (or recover) the public link for one settled assistant answer. */
export function shareAnswer(
	getToken: GetToken,
	conversationId: string,
	messageId: string
): Promise<SharedAnswerLink> {
	return apiJson<SharedAnswerLink>(getToken, "/api/shared", {
		method: "POST",
		body: { conversationId, messageId },
	});
}

/** Every link this account has minted, newest first, revoked ones included. */
export function listShares(getToken: GetToken): Promise<{ shares: SharedAnswerSummary[] }> {
	return apiJson<{ shares: SharedAnswerSummary[] }>(getToken, "/api/shared");
}

/** Take a link back. The id stays, so re-sharing that answer revives it. */
export function revokeShare(getToken: GetToken, id: string): Promise<{ ok: true }> {
	return apiJson<{ ok: true }>(getToken, `/api/shared/${id}`, { method: "DELETE" });
}

/** Hand a minted link to the system share sheet. */
export async function presentShareSheet(url: string): Promise<void> {
	await Share.share(shareSheetPayload(url));
}
