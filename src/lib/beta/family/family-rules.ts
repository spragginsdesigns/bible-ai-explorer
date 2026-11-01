/**
 * Pure rules for SureWord Family (LC-17658, docs/beta/family.md): a household
 * kept in a Study Room of purpose "family", and the children in it.
 *
 * A family's people with an account are its parents: the one who started it
 * (the room's owner) and whoever joined with its invite link. Children never
 * have an account. A parent adds a child by choosing one of their own SureWord
 * Kids profiles (module "kids", kind "child", docs/beta/kids.md), and the
 * family keeps only a link to that profile, a room post of kind "child" whose
 * data is `{ childId }`. The name and age band are read from the profile
 * itself every time, so Family never holds a child record of its own: rename
 * the child in Kids and the family shows the new name, delete the profile and
 * the child leaves the family.
 *
 * The views below are allowlists: a child is `{ linkId, name, ageBand,
 * addedBy, isYours, canRemove }`, and no view carries an account id or
 * another parent's store item id.
 *
 * No imports on purpose: tests/beta-family.test.mjs loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

/** The `module` a family's own posts are written under. */
export const FAMILY_MODULE = "family";
/** A family post linking one of a parent's SureWord Kids profiles. */
export const FAMILY_CHILD_KIND = "child";
/** Children one family holds (Kids allows 8 profiles per parent). */
export const FAMILY_CHILDREN_MAX = 12;

export type FamilyRole = "owner" | "leader" | "member";
export type FamilyAgeBand = "3-5" | "6-8" | "9-12";

const AGE_LABEL: Record<FamilyAgeBand, string> = { "3-5": "Ages 3-5", "6-8": "Ages 6-8", "9-12": "Ages 9-12" };

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A family id is a room id: checked before any query, so a hand-typed path is a 404. */
export function isFamilyId(value: unknown): value is string {
	return typeof value === "string" && ID_PATTERN.test(value);
}

/** What a parent may send to add a child: one of their own Kids profiles, by id. Anything else is ignored. */
export function checkAddChild(input: unknown): Checked<{ childId: string }> {
	const childId = input && typeof input === "object" ? (input as Record<string, unknown>).childId : undefined;
	if (!isFamilyId(childId)) return { ok: false, error: "Choose one of your children from SureWord Kids." };
	return { ok: true, value: { childId } };
}

/** The Kids profile a family's child post links to, or null when the post is not one. */
export function readChildLink(post: { kind: string; data: unknown }): { childId: string } | null {
	if (post.kind !== FAMILY_CHILD_KIND) return null;
	const data = post.data as Record<string, unknown> | null;
	if (!data || typeof data !== "object" || !isFamilyId(data.childId)) return null;
	return { childId: data.childId };
}

/** The parent who added a child, or the family's owner, may take the child out of the family. The profile stays in Kids. */
export function canRemoveChild(link: { authorId: string }, viewer: { userId: string; role: FamilyRole }): boolean {
	return link.authorId === viewer.userId || viewer.role === "owner";
}

export function ageBandLabel(band: FamilyAgeBand): string {
	return AGE_LABEL[band];
}

export interface FamilyChildView {
	/** The family's link to the profile (the room post), never the profile's own id. */
	linkId: string;
	name: string;
	ageBand: FamilyAgeBand;
	ageLabel: string;
	/** The name the parent who added them goes by in the family. */
	addedBy: string;
	isYours: boolean;
	canRemove: boolean;
}

/** A child as any parent in the family sees them: the allowlist. */
export function childView(
	link: { id: string; authorId: string },
	child: { name: string; ageBand: FamilyAgeBand },
	author: { displayName: string },
	viewer: { userId: string; role: FamilyRole },
): FamilyChildView {
	return {
		linkId: link.id,
		name: child.name,
		ageBand: child.ageBand,
		ageLabel: ageBandLabel(child.ageBand),
		addedBy: author.displayName,
		isYours: link.authorId === viewer.userId,
		canRemove: canRemoveChild(link, viewer),
	};
}

/** Youngest first, then in the order they were added (the caller passes them oldest first). */
export function sortChildren<T extends { ageBand: FamilyAgeBand }>(children: readonly T[]): T[] {
	const order: Record<FamilyAgeBand, number> = { "3-5": 0, "6-8": 1, "9-12": 2 };
	return children
		.map((child, index) => ({ child, index }))
		.sort((a, b) => order[a.child.ageBand] - order[b.child.ageBand] || a.index - b.index)
		.map((entry) => entry.child);
}
