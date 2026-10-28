/**
 * The message contract between the native note screen and the custom TenTap
 * editor bundle (`mobile/editor-web`). Both sides import this file, so the
 * bridge name and message types cannot drift apart.
 */

/** Must equal the tiptap extension's name: TenTap keys bridges by it. */
export const WIKILINK_BRIDGE_NAME = "wikilinkDecoration";

export enum WikilinkActionType {
	/** native -> editor: the lowercased titles/aliases that resolve to a note. */
	SetTargets = "wikilink-set-targets",
	/** editor -> native: the reader tapped a resolved link. */
	Open = "wikilink-open",
}

export type WikilinkMessage =
	| { type: WikilinkActionType.SetTargets; payload: string[] }
	| { type: WikilinkActionType.Open; payload: { target: string } };
