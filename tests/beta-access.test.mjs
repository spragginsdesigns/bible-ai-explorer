/**
 * SureWord Beta (LC-17631, docs/beta/README.md): the founders-only gate, the
 * module registry, and the source contracts every beta page and API route
 * must keep as modules are added by parallel runs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseUserIdAllowlist } from "../src/lib/entitlements-rules.ts";
import { betaAccessStatus, isBetaUserId } from "../src/lib/beta/access-rules.ts";
import {
	BETA_CLASSIC_LINKS,
	BETA_DESTINATIONS,
	BETA_MODULES,
	betaModuleHref,
	betaModulesByProgress,
	betaModulesFor,
	betaSectionForPath,
	findBetaModule,
	isBetaDestinationId,
} from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

function filesUnder(relativeDir, name) {
	const root = join(repoRoot, relativeDir);
	if (!existsSync(root)) return [];
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry === name) out.push(relative(repoRoot, full));
		}
	};
	walk(root);
	return out.sort();
}

const FOUNDER = "user_founder";
const OTHER = "user_someone_else";

test("only ids on BETA_USER_IDS are let in", () => {
	const allowlist = parseUserIdAllowlist(` ${FOUNDER} , user_second ,,`);
	assert.equal(isBetaUserId(FOUNDER, allowlist), true);
	assert.equal(isBetaUserId("user_second", allowlist), true);
	assert.equal(isBetaUserId(OTHER, allowlist), false);
	assert.equal(betaAccessStatus(FOUNDER, allowlist), 200);
	assert.equal(betaAccessStatus(OTHER, allowlist), 404, "404, not 403: the beta must look like any missing path");
});

test("an unset or empty allowlist lets nobody in", () => {
	for (const raw of [undefined, null, "", "  ", ",, ,"]) {
		const allowlist = parseUserIdAllowlist(raw);
		assert.deepEqual(allowlist, []);
		assert.equal(isBetaUserId(FOUNDER, allowlist), false);
		assert.equal(isBetaUserId("", allowlist), false, "an empty id must never match an empty entry");
	}
});

test("a missing or blank session id is never a founder", () => {
	const allowlist = [FOUNDER];
	for (const id of [null, undefined, "", "   "]) assert.equal(isBetaUserId(id, allowlist), false);
	assert.equal(isBetaUserId(` ${FOUNDER} `, allowlist), true);
	assert.equal(isBetaUserId(FOUNDER.toUpperCase(), allowlist), false, "Clerk ids are case-sensitive");
});

test("the registry covers every destination with unique, routable modules", () => {
	assert.deepEqual(BETA_DESTINATIONS.map((item) => item.id), ["home", "bible", "study", "library", "learn"]);
	const keys = new Set();
	for (const entry of BETA_MODULES) {
		const key = `${entry.destination}/${entry.slug}`;
		assert.equal(keys.has(key), false, `duplicate module ${key}`);
		keys.add(key);
		assert.match(entry.slug, /^[a-z][a-z0-9-]*$/, `${key}: slug must be a URL segment`);
		assert.equal(isBetaDestinationId(entry.destination), true, `${key}: unknown destination`);
		assert.ok(["planned", "building", "live"].includes(entry.status), `${key}: status`);
		assert.ok(["P0", "P1", "P2", "P3"].includes(entry.priority), `${key}: priority`);
		assert.ok(entry.title && entry.tagline && entry.summary && entry.inspiredBy, `${key}: copy`);
		assert.ok(entry.capabilities.length >= 3, `${key}: capabilities`);
		assert.ok(entry.builtOn.length >= 1, `${key}: builtOn`);
		if (entry.issue !== undefined) assert.match(entry.issue, /^LC-\d+$/, `${key}: issue`);
		assert.equal(betaModuleHref(entry), `/beta/${key}`);
		assert.equal(findBetaModule(entry.destination, entry.slug), entry);
	}
	for (const id of ["bible", "study", "library", "learn"]) {
		assert.ok(betaModulesFor(id).length >= 1, `${id} has no modules`);
		assert.ok(BETA_CLASSIC_LINKS[id].length >= 1, `${id} has no classic links`);
	}
	assert.equal(findBetaModule("study", "nope"), null);
	assert.equal(findBetaModule("learn", "projects"), null, "a slug only exists under its own destination");
});

test("modules are ordered live, then building, then planned, by priority", () => {
	const order = { live: 0, building: 1, planned: 2 };
	const sorted = betaModulesByProgress();
	assert.equal(sorted.length, BETA_MODULES.length);
	for (let i = 1; i < sorted.length; i++) {
		const a = sorted[i - 1];
		const b = sorted[i];
		assert.ok(order[a.status] < order[b.status] || (order[a.status] === order[b.status] && a.priority <= b.priority), `${a.slug} before ${b.slug}`);
	}
	const mixed = betaModulesByProgress([
		{ ...BETA_MODULES[0], slug: "p", status: "planned", priority: "P0" },
		{ ...BETA_MODULES[0], slug: "l", status: "live", priority: "P3" },
		{ ...BETA_MODULES[0], slug: "b", status: "building", priority: "P2" },
	]);
	assert.deepEqual(mixed.map((item) => item.slug), ["l", "b", "p"]);
});

test("the active beta tab is read from the path", () => {
	assert.equal(betaSectionForPath("/beta"), "home");
	assert.equal(betaSectionForPath("/beta/"), "home");
	assert.equal(betaSectionForPath("/beta?from=menu"), "home");
	assert.equal(betaSectionForPath("/beta/study"), "study");
	assert.equal(betaSectionForPath("/beta/study/projects/abc"), "study");
	assert.equal(betaSectionForPath("/beta/learn/paths#unit-2"), "learn");
	assert.equal(betaSectionForPath("/beta/settings"), null);
	assert.equal(betaSectionForPath("/betamax"), null);
	assert.equal(betaSectionForPath("/today"), null);
	assert.equal(betaSectionForPath("/"), null);
});

test("every beta page and the layout turn away anyone off the list before rendering", () => {
	const layout = read("src/app/beta/layout.tsx");
	assert.match(layout, /await requireBetaPage\(\)/);
	assert.match(layout, /robots: \{ index: false, follow: false, nocache: true \}/);
	const pages = filesUnder("src/app/beta", "page.tsx");
	assert.ok(pages.length >= 9, "home, four destinations and four module placeholders");
	for (const page of pages) {
		assert.match(read(page), /await requireBetaPage\(\)/, `${page} must call requireBetaPage() itself`);
	}
	for (const file of [...pages, "src/app/beta/layout.tsx"]) {
		const source = read(file);
		assert.equal(/export const metadata\b/.test(source), false, `${file}: static metadata titles everyone else's 404 too`);
		if (/generateMetadata/.test(source)) assert.match(source, /return betaMetadata\(/, `${file}: metadata must go through betaMetadata()`);
	}
	const access = read("src/lib/beta/access.ts");
	assert.match(access, /parseUserIdAllowlist\(process\.env\.BETA_USER_IDS\)/);
	assert.match(access, /return \(await currentBetaUserId\(\)\) \? metadata : \{\};/);
	assert.match(access, /notFound\(\)/);
	assert.equal(access.includes("forbidden()"), false, "a 403 would admit the beta exists");
});

test("every /api/beta route except the membership probe answers 404 to anyone off the list", () => {
	const routes = filesUnder("src/app/api/beta", "route.ts");
	assert.ok(routes.includes("src/app/api/beta/access/route.ts"));
	for (const route of routes) {
		const source = read(route);
		if (route === "src/app/api/beta/access/route.ts") {
			assert.match(source, /beta: Boolean\(userId\)/);
			assert.equal(/prisma/.test(source), false, "the probe reads nothing but the session and the env");
			continue;
		}
		assert.match(source, /requireBetaApi\(\)/, `${route} must gate with requireBetaApi()`);
	}
});

test("signed-out visitors meet the same redirect or 401 as any unknown path, and nothing advertises /beta", () => {
	const middleware = read("src/middleware.ts");
	assert.equal(middleware.includes('"/beta'), false, "/beta must not be a public route");
	assert.equal(middleware.includes('"/api/beta'), false, "/api/beta must not be a public route");
	assert.equal(read("src/app/robots.ts").includes("/beta"), false);
	assert.equal(read("src/app/sitemap.ts").includes("/beta"), false);
});

test("a live module has its own route, and every static beta route belongs to a module", () => {
	for (const destination of ["bible", "study", "library", "learn"]) {
		const dir = join(repoRoot, "src/app/beta", destination);
		assert.ok(existsSync(join(dir, "page.tsx")), `${destination} page`);
		assert.ok(existsSync(join(dir, "[slug]", "page.tsx")), `${destination} placeholder`);
		for (const child of readdirSync(dir)) {
			if (child === "page.tsx" || child === "[slug]" || !statSync(join(dir, child)).isDirectory()) continue;
			assert.ok(findBetaModule(destination, child), `src/app/beta/${destination}/${child} is not a registered module`);
		}
	}
	for (const entry of BETA_MODULES) {
		const own = join(repoRoot, "src/app/beta", entry.destination, entry.slug, "page.tsx");
		if (entry.status === "live") assert.ok(existsSync(own), `${entry.slug} is live but still renders the placeholder`);
	}
});

test("every module has its own icon, and the main tab bar steps aside inside the beta", () => {
	const visuals = read("src/components/beta/visuals.tsx");
	for (const entry of BETA_MODULES) assert.match(visuals, new RegExp(`\\n\\t${entry.slug}: [A-Z]`), `${entry.slug} icon`);
	const nav = read("src/components/MobileBottomNav.tsx");
	assert.match(nav, /pathname === "\/beta" \|\| pathname\.startsWith\("\/beta\/"\)/);
});
