/**
 * SureWord Family (LC-17658, docs/beta/family.md): the pure rules
 * (src/lib/beta/family/family-rules.ts), and the contract the server half
 * (src/lib/beta/family/family.ts and its routes) keeps: a family is a Study
 * Room of purpose "family", never a second membership system, and a child is
 * a SureWord Kids profile, never a child record of Family's own.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	FAMILY_CHILDREN_MAX,
	FAMILY_CHILD_KIND,
	FAMILY_MODULE,
	ageBandLabel,
	canRemoveChild,
	checkAddChild,
	childView,
	isFamilyId,
	readChildLink,
	sortChildren,
} from "../src/lib/beta/family/family-rules.ts";
import { ROOM_PURPOSE_PATHS, roomInvitePath } from "../src/lib/beta/rooms/rooms-rules.ts";
import { KIDS_MAX_CHILDREN } from "../src/lib/beta/kids/kids-rules.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const filesUnder = (dir) =>
	readdirSync(join(repoRoot, dir)).flatMap((name) => {
		const path = join(dir, name);
		return statSync(join(repoRoot, path)).isDirectory() ? filesUnder(path) : [path];
	});

const MOM = "user_mom_private_id";
const DAD = "user_dad_private_id";
const mom = { userId: MOM, role: "owner" };
const dad = { userId: DAD, role: "member" };

test("a family is a Study Room of purpose family, with its own pages and invite path", () => {
	assert.deepEqual(ROOM_PURPOSE_PATHS.family, { page: "/beta/together/family", api: "/api/beta/family" });
	assert.equal(roomInvitePath("AbCdEfGh_-123456", "family"), "/beta/together/family/join/AbCdEfGh_-123456");
	for (const path of [
		"src/app/beta/together/family/page.tsx",
		"src/app/beta/together/family/[id]/page.tsx",
		"src/app/beta/together/family/join/[token]/page.tsx",
		"src/app/api/beta/family/route.ts",
		"src/app/api/beta/family/join/[token]/route.ts",
	]) {
		assert.ok(existsSync(join(repoRoot, path)), path);
	}
	const entry = BETA_MODULES.find((module) => module.slug === "family");
	assert.equal(entry?.issue, "LC-17658");
	assert.ok(entry && ["building", "live"].includes(entry.status));
});

test("Family keeps no membership or child record of its own", () => {
	const server = read("src/lib/beta/family/family.ts");
	// Rooms is the only way in: no direct table access, so every read starts from membership.
	assert.doesNotMatch(server, /from "@\/lib\/prisma"/);
	assert.match(server, /openModuleRoom\(userId, familyId, FAMILY_PURPOSE, FAMILY_MODULE\)/);
	assert.match(server, /getRoomView\(userId, familyId, now, FAMILY_PURPOSE\)/);
	// Children come from Kids' own profiles, read through Kids' own functions.
	assert.match(server, /from "@\/lib\/beta\/kids\/children"/);
	assert.doesNotMatch(server, /createBetaItem|updateBetaItem|betaItem\./);
	// Every Family route goes through the beta gate and Rooms' purpose-scoped functions.
	for (const path of filesUnder("src/app/api/beta/family")) {
		const source = read(path);
		assert.match(source, /const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/, path);
		assert.doesNotMatch(source, /from "@\/lib\/prisma"/, path);
	}
});

test("adding a child takes only a profile id", () => {
	assert.deepEqual(checkAddChild({ childId: "cmh1abcdef0000xyz" }), { ok: true, value: { childId: "cmh1abcdef0000xyz" } });
	// A name, age or anything else about a child is never accepted here; only Kids makes profiles.
	assert.deepEqual(checkAddChild({ childId: "cmh1abcdef0000xyz", name: "Sam", ageBand: "6-8" }), { ok: true, value: { childId: "cmh1abcdef0000xyz" } });
	for (const bad of [null, undefined, "cmh1", {}, { childId: "" }, { childId: 42 }, { childId: "../../etc" }, { childId: "x".repeat(65) }]) {
		assert.equal(checkAddChild(bad).ok, false, JSON.stringify(bad));
	}
	assert.equal(isFamilyId("cmh1abcdef0000xyz"), true);
	assert.equal(isFamilyId("not a room"), false);
});

test("a child post is a link to a profile and nothing else", () => {
	assert.deepEqual(readChildLink({ kind: FAMILY_CHILD_KIND, data: { childId: "cmhkid1" } }), { childId: "cmhkid1" });
	assert.equal(readChildLink({ kind: "devotion", data: { childId: "cmhkid1" } }), null);
	assert.equal(readChildLink({ kind: FAMILY_CHILD_KIND, data: null }), null);
	assert.equal(readChildLink({ kind: FAMILY_CHILD_KIND, data: { name: "Sam" } }), null);
	assert.equal(FAMILY_MODULE, "family");
	assert.ok(FAMILY_CHILDREN_MAX >= KIDS_MAX_CHILDREN, "one parent's whole Kids list fits in a family");
});

test("who may take a child out of the family", () => {
	const momsChild = { authorId: MOM };
	const dadsChild = { authorId: DAD };
	assert.equal(canRemoveChild(momsChild, mom), true);
	assert.equal(canRemoveChild(dadsChild, dad), true, "the parent who added them");
	assert.equal(canRemoveChild(dadsChild, mom), true, "the family's owner");
	assert.equal(canRemoveChild(momsChild, dad), false, "not the other parent's child");
});

test("a child's view is an allowlist: no account id, no profile id, no progress", () => {
	const link = { id: "cmhlink1", authorId: DAD, data: { childId: "cmhkidprofile" } };
	const child = { id: "cmhkidprofile", name: "Sam", ageBand: "6-8", stars: ["creation"], verses: ["noah"] };
	const view = childView(link, child, { displayName: "Dad", userId: DAD }, mom);
	assert.deepEqual(view, { linkId: "cmhlink1", name: "Sam", ageBand: "6-8", ageLabel: "Ages 6-8", addedBy: "Dad", isYours: false, canRemove: true });
	const text = JSON.stringify(view);
	for (const secret of [DAD, MOM, "cmhkidprofile", "creation", "noah"]) assert.ok(!text.includes(secret), secret);
	assert.equal(childView(link, child, { displayName: "Dad" }, dad).isYours, true);
	assert.equal(ageBandLabel("3-5"), "Ages 3-5");
});

test("children are listed youngest first, then in the order they were added", () => {
	const sorted = sortChildren([
		{ name: "Ada", ageBand: "9-12" },
		{ name: "Ben", ageBand: "3-5" },
		{ name: "Cal", ageBand: "6-8" },
		{ name: "Dee", ageBand: "3-5" },
	]);
	assert.deepEqual(sorted.map((child) => child.name), ["Ben", "Dee", "Cal", "Ada"]);
});
