import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import * as plans from "../src/lib/billing/plans.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/**
 * Loads a TypeScript module with its imports replaced by injected values - the
 * harness tests/bible-crossrefs-route.test.mjs uses - so the real route code
 * runs without Next's "@/" alias resolution.
 */
function loadModule(relativePath, dependencies, returns) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const names = Object.keys(dependencies);
	const factory = new Function(...names, `${stripTypeScriptTypes(source)}\nreturn ${returns};`);
	return factory(...names.map((name) => dependencies[name]));
}

const { version } = JSON.parse(read("../package.json"));
const constants = loadModule(
	"../src/lib/constants.ts",
	{ version },
	"{ ANDROID_APK_URL, MACOS_DMG_URL }",
);
const { LANDING_FAQ } = loadModule(
	"../src/lib/marketing/faq.ts",
	{ FREE_DAILY_MESSAGES: plans.FREE_DAILY_MESSAGES },
	"{ LANDING_FAQ }",
);
const legal = loadModule(
	"../src/lib/marketing/legal-content.ts",
	{ ...plans },
	"{ PRIVACY_POLICY, MEMBERSHIP_TERMS, PRIVACY_CONTACT_EMAIL }",
);
const pages = loadModule(
	"../src/lib/marketing/markdown-pages.ts",
	{ ...constants, LANDING_FAQ, ...legal },
	"{ buildIndexMarkdown, buildPrivacyMarkdown, buildTermsMarkdown, getTheAppSection, KJV_STANCE, SITE_URL }",
);
const llms = loadModule("../src/app/llms.txt/route.ts", { ...plans, LANDING_FAQ, getTheAppSection: pages.getTheAppSection, KJV_STANCE: pages.KJV_STANCE, SITE_URL: pages.SITE_URL }, "{ GET, revalidate }");

// Everything src/middleware.ts sends to /sign-in (or 401s) when signed out.
const AUTH_GATED = ["/settings", "/notes", "/bible", "/cross", "/membership", "/api"];
// llmstxt.org "file list" sections: every entry must be a link item.
const LINK_LIST_SECTIONS = new Set(["Get the app", "Pages", "Optional"]);
const LINK_ITEM = /^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: \S.*)?$/;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;

function siteLinks(text) {
	return [...text.matchAll(/https:\/\/sureword\.app(\/[^\s)>]*)?/g)].map((m) => m[1] ?? "/");
}

function assertNoAuthGatedLinks(text, label) {
	for (const path of siteLinks(text)) {
		const gated = AUTH_GATED.find((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
		assert.equal(gated, undefined, `${label} links auth-gated path ${path}`);
	}
}

async function llmsText() {
	const response = llms.GET();
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type"), /^text\/plain; charset=utf-8$/);
	return response.text();
}

test("llms.txt follows the llmstxt.org shape: one H1 first, then a blockquote", async () => {
	const lines = (await llmsText()).split("\n");
	assert.match(lines[0], /^# \S/, "the first line must be the H1");
	assert.equal(lines.filter((line) => /^# /.test(line)).length, 1, "exactly one H1");
	const next = lines.slice(1).find((line) => line.trim() !== "");
	assert.match(next, /^> \S/, "the summary blockquote must follow the H1");
	assert.equal(typeof llms.revalidate, "number");
});

test("llms.txt sections: link lists are `- [name](https://url): note`, every other link is absolute", async () => {
	let section = null;
	const itemsBySection = new Map();
	for (const line of (await llmsText()).split("\n")) {
		const h2 = line.match(/^## (.+)$/);
		if (h2) {
			section = h2[1].trim();
			itemsBySection.set(section, 0);
			continue;
		}
		assert.ok(!/^#{4,} /.test(line), `heading deeper than ### is not allowed: ${line}`);
		if (/^### /.test(line)) {
			assert.equal(section, "FAQ", `### headings belong only under ## FAQ, found in ${section}`);
		}
		if (section && LINK_LIST_SECTIONS.has(section) && line.trim() !== "") {
			assert.match(line, LINK_ITEM, `${section} entry is not a link item: ${line}`);
			itemsBySection.set(section, itemsBySection.get(section) + 1);
		}
		for (const [, href] of line.matchAll(MARKDOWN_LINK)) {
			assert.match(href, /^https:\/\//, `link must be absolute https: ${href}`);
		}
	}
	for (const name of LINK_LIST_SECTIONS) {
		if (itemsBySection.has(name)) assert.ok(itemsBySection.get(name) > 0, `## ${name} is empty`);
	}
	assert.ok([...itemsBySection.keys()].some((name) => LINK_LIST_SECTIONS.has(name)), "no link-list section at all");
});

test("llms.txt links no auth-gated page and every linked markdown twin has a route", async () => {
	const text = await llmsText();
	assertNoAuthGatedLinks(text, "llms.txt");
	for (const path of siteLinks(text)) {
		if (!/\.(md|txt)$/.test(path)) continue;
		const route = new URL(`../src/app${path}/route.ts`, import.meta.url);
		assert.ok(existsSync(fileURLToPath(route)), `llms.txt links ${path} but src/app${path}/route.ts does not exist`);
	}
});

test("llms.txt stays under 12KB", async () => {
	const bytes = Buffer.byteLength(await llmsText(), "utf8");
	assert.ok(bytes < 12 * 1024, `llms.txt is ${bytes} bytes`);
});

const MARKDOWN_ROUTES = [
	["/index.md", "../src/app/index.md/route.ts", { buildIndexMarkdown: pages.buildIndexMarkdown }],
	["/privacy.md", "../src/app/privacy.md/route.ts", { buildPrivacyMarkdown: pages.buildPrivacyMarkdown }],
	["/terms.md", "../src/app/terms.md/route.ts", { buildTermsMarkdown: pages.buildTermsMarkdown }],
];

for (const [path, file, dependencies] of MARKDOWN_ROUTES) {
	test(`${path} serves non-empty markdown with an H1 and no gated links`, async () => {
		const route = loadModule(file, dependencies, "{ GET, revalidate }");
		const response = route.GET();
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
		assert.equal(typeof route.revalidate, "number");
		const body = await response.text();
		assert.match(body.split("\n")[0], /^# \S/);
		assert.equal(body.split("\n").filter((line) => /^# /.test(line)).length, 1);
		assert.ok(body.length > 200, `${path} is suspiciously short`);
		assertNoAuthGatedLinks(body, path);
		for (const [, href] of body.matchAll(MARKDOWN_LINK)) {
			assert.match(href, /^https:\/\//, `${path} link must be absolute https: ${href}`);
		}
	});
}

test("markdown twins carry the same text the HTML pages render", () => {
	const privacy = pages.buildPrivacyMarkdown();
	const terms = pages.buildTermsMarkdown();
	for (const [doc, markdown] of [[legal.PRIVACY_POLICY, privacy], [legal.MEMBERSHIP_TERMS, terms]]) {
		assert.ok(markdown.includes(doc.byline));
		for (const block of doc.blocks) {
			if (block.type === "h2") assert.ok(markdown.includes(`## ${block.text}`), block.text);
		}
	}
	assert.ok(privacy.includes(legal.PRIVACY_CONTACT_EMAIL));
	assert.ok(terms.includes(`Free includes ${plans.FREE_DAILY_MESSAGES} AI actions per day.`));
	assert.ok(terms.includes(`Pro is $${plans.PRO_MONTHLY_PRICE_CENTS / 100} USD per month`));
	const index = pages.buildIndexMarkdown();
	for (const item of LANDING_FAQ) assert.ok(index.includes(`### ${item.question}`), item.question);
});

test("every markdown twin and llms.txt is public in middleware and allowed in robots", () => {
	const middleware = read("../src/middleware.ts");
	const robots = read("../src/app/robots.ts");
	for (const path of ["/llms.txt", "/index.md", "/privacy.md", "/terms.md"]) {
		assert.ok(middleware.includes(`"${path}"`), `${path} missing from the middleware public routes`);
		assert.ok(robots.includes(`"${path}"`), `${path} missing from robots allow`);
	}
});
