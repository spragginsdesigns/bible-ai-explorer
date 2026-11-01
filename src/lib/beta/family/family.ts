import "server-only";

import { getChild, listChildren } from "@/lib/beta/kids/children";
import { RoomError, getRoomView, openModuleRoom, type ModuleRoom, type RoomView } from "@/lib/beta/rooms/rooms";
import type { RoomPurpose } from "@/lib/beta/rooms/rooms-rules";
import {
	FAMILY_CHILDREN_MAX,
	FAMILY_CHILD_KIND,
	FAMILY_MODULE,
	ageBandLabel,
	canRemoveChild,
	checkAddChild,
	childView,
	readChildLink,
	sortChildren,
	type FamilyAgeBand,
	type FamilyChildView,
} from "@/lib/beta/family/family-rules";

/**
 * SureWord Family (LC-17658, docs/beta/family.md): a household, kept in a
 * Study Room of purpose "family" (docs/beta/rooms.md), the way SureWord Groups
 * keeps a group.
 *
 * Membership, the invite link, leaving and removal are Study Rooms' own
 * functions, called with this purpose; every account in a family is one of
 * its parents. Children are SureWord Kids profiles on a parent's account
 * (docs/beta/kids.md), linked into the family by a room post under module
 * "family", reached only through `openModuleRoom`, so every read and write
 * starts from the caller's membership and a family they are not in is the same
 * 404 as one that does not exist.
 *
 * The only private data read here: the caller's own Kids profiles (to choose
 * one), and each linked profile, looked up by the id of the parent who linked
 * it, which is their explicit choice to show that child to the family. A
 * child's name never reaches a model.
 */

export const FAMILY_PURPOSE: RoomPurpose = "family";

const notFound = () => new RoomError("Not found", 404);

async function openFamily(userId: string, familyId: string): Promise<ModuleRoom> {
	const family = await openModuleRoom(userId, familyId, FAMILY_PURPOSE, FAMILY_MODULE);
	if (!family) throw notFound();
	return family;
}

export interface FamilyView {
	/** Study Rooms' view of the room: its parents, and the owner's invite link. */
	room: Omit<RoomView, "posts" | "plan" | "presets">;
	children: FamilyChildView[];
	/** The caller's own Kids profiles not yet in this family, to choose from. */
	addable: { id: string; name: string; ageBand: FamilyAgeBand; ageLabel: string }[];
	/** How many Kids profiles the caller has, so the page can send them to Kids to make one. */
	yourProfiles: number;
}

/** The family as the caller sees it, or null when they are not in it. */
export async function getFamilyView(userId: string, familyId: string, now = new Date()): Promise<FamilyView | null> {
	const [roomView, family] = await Promise.all([getRoomView(userId, familyId, now, FAMILY_PURPOSE), openModuleRoom(userId, familyId, FAMILY_PURPOSE, FAMILY_MODULE)]);
	if (!roomView || !family) return null;
	const [members, rows, mine] = await Promise.all([family.members(), family.posts(), listChildren(userId)]);
	const byUser = new Map(members.map((member) => [member.userId, member]));
	const viewer = { userId, role: family.me.role };

	const linked = await Promise.all(
		rows.map(async (row) => {
			const link = readChildLink(row);
			// A link outlives the parent who made it only by a moment (leaving deletes it).
			const author = byUser.get(row.authorId);
			if (!link || !author) return null;
			// Read from the profile itself, on the account of the parent who linked it.
			const child = await getChild(row.authorId, link.childId);
			return child ? { view: childView(row, child, author, viewer), key: `${row.authorId}:${link.childId}` } : null;
		}),
	);
	const present = linked.filter((entry): entry is { view: FamilyChildView; key: string } => entry !== null);
	const yours = new Set(present.map((entry) => entry.key));

	// Study Rooms' own posts and reading plan are not part of a family yet.
	const { id, name, description, archived, isOwner, you, inviteToken, members: parents } = roomView;
	return {
		room: { id, name, description, archived, isOwner, you, ...(isOwner && { inviteToken }), members: parents },
		children: sortChildren(present.map((entry) => entry.view)),
		addable: mine.filter((child) => !yours.has(`${userId}:${child.id}`)).map((child) => ({ id: child.id, name: child.name, ageBand: child.ageBand, ageLabel: ageBandLabel(child.ageBand) })),
		yourProfiles: mine.length,
	};
}

/** A parent adds one of their own Kids profiles to the family. */
export async function addFamilyChild(userId: string, familyId: string, input: unknown): Promise<void> {
	const checked = checkAddChild(input);
	if (!checked.ok) throw new RoomError(checked.error);
	const family = await openFamily(userId, familyId);
	if (family.room.archived) throw new RoomError("This family is archived. Its owner can restore it.", 409);
	// Only the caller's own profiles: another parent's child id reads like one that does not exist.
	const child = await getChild(userId, checked.value.childId);
	if (!child) throw new RoomError("That profile is not one of yours. Choose one of your children from SureWord Kids.");
	const links = (await family.posts()).filter((row) => readChildLink(row) !== null);
	if (links.some((row) => row.authorId === userId && readChildLink(row)?.childId === child.id)) {
		throw new RoomError(`${child.name} is already in this family.`, 409);
	}
	if (links.length >= FAMILY_CHILDREN_MAX) throw new RoomError(`A family holds ${FAMILY_CHILDREN_MAX} children.`, 409);
	// Written as the parent: the profile is on their account, so the link goes when they leave.
	await family.create({ kind: FAMILY_CHILD_KIND, body: "", data: { childId: child.id } });
}

/** The parent who added a child, or the owner, takes them out of the family. Their Kids profile is untouched. */
export async function removeFamilyChild(userId: string, familyId: string, linkId: string): Promise<void> {
	const family = await openFamily(userId, familyId);
	const row = await family.post(linkId);
	if (!row || !readChildLink(row)) throw notFound();
	if (!canRemoveChild(row, { userId, role: family.me.role })) throw new RoomError("Only the parent who added them, or the family's owner, can do that.", 403);
	await family.remove(row.id);
}
