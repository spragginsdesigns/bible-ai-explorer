#!/usr/bin/env node
// Generate the offline Apple atlas from the same reviewed inputs as Android.
// node scripts/build-apple-atlas.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const corePath = "src/lib/bible/atlas-core.ts";
const files = [corePath, "src/data/books.json",
	...["events", "people", "places", "relations"].map((name) => `src/data/bible-atlas/${name}.json`)];
const resourceDir = "macos/Shared/Atlas/AtlasData";

function compileCore(source) {
	const ast = ts.createSourceFile(corePath, source, ts.ScriptTarget.ES2020, true);
	function visit(node) {
		if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
			node.kind === ts.SyntaxKind.ImportKeyword ||
			(ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
				["eval", "Function", "fetch", "require"].includes(node.expression.text))) {
			throw new Error("Atlas core must remain import-free pure bundled code.");
		}
		ts.forEachChild(node, visit);
	}
	visit(ast);
	const result = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, removeComments: false },
		reportDiagnostics: true,
	});
	if (result.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) {
		throw new Error("Atlas TypeScript compilation failed.");
	}
	return result.outputText;
}

// Only API-envelope/validation glue lives here. Ranking, reference grammar,
// filtering, graph traversal and pagination are the unmodified canonical core.
// Arguments are JSON data passed to a fixed function, never evaluated strings.
const bridge = `
globalThis.surewordAtlasQuery = function(operation, parametersJSON) {
	const p = JSON.parse(parametersJSON);
	const ok = (value) => JSON.stringify({ status: 200, value });
	const fail = (status, error) => JSON.stringify({ status, error });
	const chapterValid = (book, chapter) => {
		const meta = books.find((item) => item.order === book);
		return meta && Number.isInteger(chapter) && chapter >= 1 && chapter <= meta.chapters;
	};
	const era = typeof p.era === "string" ? p.era.trim() : undefined;
	if (era && !core.ATLAS_ERAS.includes(era)) return fail(400, "Unknown Bible atlas era.");
	switch (operation) {
		case "timeline": {
			if (p.book !== undefined && !books.some((item) => item.order === p.book))
				return fail(400, "That is not a book of the Bible.");
			if (p.chapter !== undefined && !chapterValid(p.book, p.chapter))
				return fail(400, "That is not a chapter of the Bible.");
			const events = core.selectTimelineEvents(data, books, { era, book: p.book, chapter: p.chapter, personId: p.personID });
			return ok({ allEras: core.ATLAS_ERAS, eras: core.groupEventsByEra(data, events),
				events: events.map((event) => core.toEventView(data, event)) });
		}
		case "entities": {
			if (!["person", "place"].includes(p.kind)) return fail(400, "Invalid Bible atlas entity kind.");
			const listing = core.listEntities(data, { kind: p.kind, era, cursor: p.cursor?.trim() || undefined, limit: p.limit ?? 24 });
			return ok({ kind: p.kind, results: listing.items, nextCursor: listing.nextCursor });
		}
		case "search": {
			const query = (p.query ?? "").trim();
			const limit = Number.isInteger(p.limit) ? Math.min(Math.max(p.limit, 1), 25) : 12;
			return ok(core.searchAtlasDataWithCounts(data, query, limit));
		}
		case "chapter":
			return chapterValid(p.book, p.chapter) ? ok(core.whoIsInChapter(data, books, p.book, p.chapter))
				: fail(400, "That is not a chapter of the Bible.");
		case "entity": {
			const entity = core.getEntityView(data, (p.id ?? "").trim());
			return entity ? ok({ entity }) : fail(404, "No such person or place.");
		}
		case "event": {
			const id = (p.id ?? "").trim();
			if (!id) return fail(400, "An event id is required.");
			const event = data.events.find((item) => item.id === id);
			return event ? ok({ event: core.toEventView(data, event) }) : fail(404, "No such event.");
		}
		case "connection": {
			const from = (p.from ?? "").trim(), to = (p.to ?? "").trim();
			if (!from || !to) return fail(400, "Both person ids are required.");
			const connection = core.shortestPersonConnectionPath(data, from, to);
			return connection ? ok({ path: connection }) : fail(404, "No reviewed connection was found.");
		}
		default: return fail(400, "Unknown Bible atlas operation.");
	}
};
`;

// Expected payloads come directly from the source TypeScript core, independently
// of the compiled JS bridge; Swift and Node exercise these same golden cases.
function goldenCases(core, data, books) {
	const cases = [];
	const add = (name, operation, parameters, value) => cases.push({ name, operation, parameters, status: 200, value });
	const error = (name, operation, parameters, status) => cases.push({ name, operation, parameters, status });
	const timeline = (parameters) => {
		const events = core.selectTimelineEvents(data, books, {
			era: parameters.era, book: parameters.book, chapter: parameters.chapter, personId: parameters.personID,
		});
		return { allEras: core.ATLAS_ERAS, eras: core.groupEventsByEra(data, events), events: events.map((item) => core.toEventView(data, item)) };
	};
	for (const [name, parameters] of [
		["timeline-all", {}], ["timeline-era", { era: "Life of Christ" }],
		["timeline-book", { book: 1 }], ["timeline-chapter", { book: 6, chapter: 6 }],
		["timeline-journey", { personID: "moses" }],
		["timeline-empty", { personID: "not-an-atlas-person" }],
	]) add(name, "timeline", parameters, timeline(parameters));
	for (const [name, parameters] of [
		["people-page-one", { kind: "person", limit: 3 }],
		["people-page-two", { kind: "person", limit: 3, cursor: "3" }],
		["people-era", { kind: "person", era: "The Early Church", limit: 100 }],
		["places", { kind: "place", limit: 100 }],
		["places-era-empty", { kind: "place", era: "Life of Christ" }],
	]) {
		const listing = core.listEntities(data, parameters);
		add(name, "entities", parameters, { kind: parameters.kind, results: listing.items, nextCursor: listing.nextCursor });
	}
	for (const query of ["Saul", "joseph", "the", "", "zz-no-atlas-match"]) {
		add("search-" + (query || "empty"), "search", { query, limit: 2 }, core.searchAtlasDataWithCounts(data, query, 2));
	}
	add("chapter-jericho", "chapter", { book: 6, chapter: 6 }, core.whoIsInChapter(data, books, 6, 6));
	add("chapter-no-events", "chapter", { book: 65, chapter: 1 }, core.whoIsInChapter(data, books, 65, 1));
	for (const id of ["abraham", "paul", "jerusalem"]) add("entity-" + id, "entity", { id }, { entity: core.getEntityView(data, id) });
	const event = data.events.find((item) => item.id === "the-flood");
	if (!event) throw new Error("Expected canonical flood fixture is missing.");
	add("event-flood", "event", { id: event.id }, { event: core.toEventView(data, event) });
	for (const [from, to] of [["abraham", "jacob"], ["jacob", "abraham"], ["paul", "paul"]]) {
		const result = core.shortestPersonConnectionPath(data, from, to);
		if (!result) throw new Error("Expected canonical trace fixture is missing.");
		add("trace-" + from + "-" + to, "connection", { from, to }, { path: result });
	}
	error("unknown-entity", "entity", { id: "not-an-atlas-person" }, 404);
	error("unknown-event", "event", { id: "not-an-atlas-event" }, 404);
	error("unknown-trace", "connection", { from: "paul", to: "not-an-atlas-person" }, 404);
	error("invalid-chapter", "chapter", { book: 1, chapter: 99 }, 400);
	error("invalid-book", "timeline", { book: 99 }, 400);
	error("invalid-era", "timeline", { era: "not-an-era" }, 400);
	return cases;
}

export async function generateAppleAtlas({ check = false } = {}) {
	// Full authored-data/reference validation, without mutating Android outputs.
	execFileSync(process.execPath, [path.join(root, "scripts/build-bible-atlas.mjs"), "--validate-only"], { cwd: root, stdio: "pipe" });
	const sourceFiles = files.map((file) => ({ path: file, sha256: sha(read(file)) }));
	const inputSha256 = sha(JSON.stringify({ sourceFiles, typescriptVersion: ts.version }));
	const data = Object.fromEntries(["events", "people", "places", "relations"].map((name) => [name, JSON.parse(read(`src/data/bible-atlas/${name}.json`))]));
	const books = JSON.parse(read("src/data/books.json"));
	const counts = Object.fromEntries(Object.entries(data).map(([name, values]) => [name, values.length]));
	const compiled = compileCore(read(corePath));
	const script = "// GENERATED by scripts/build-apple-atlas.mjs. Do not edit.\n" +
		"// Canonical core and reviewed data; no network or user-code evaluation.\n" +
		"(function () {\nconst exports = {};\n" + compiled + "\nconst core = exports;\n" +
		"const data = " + JSON.stringify(data) + ";\nconst books = " + JSON.stringify(books) + ";\n" +
		bridge + "\n}());\n";
	const manifest = { schemaVersion: 1, inputSha256, scriptSha256: sha(script), counts, sourceFiles, typescriptVersion: ts.version };
	const core = await import(pathToFileURL(path.join(root, corePath)).href);
	const golden = { schemaVersion: 1, inputSha256, counts, cases: goldenCases(core, data, books) };
	const outputs = new Map([
		[resourceDir + "/atlas.js", script],
		[resourceDir + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
		["macos/SureWord-iOSTests/AtlasOfflineGolden.json", JSON.stringify(golden) + "\n"],
	]);
	for (const [relative, content] of outputs) {
		const destination = path.join(root, relative);
		if (check) {
			if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== content) {
				throw new Error(relative + " is stale; run node scripts/build-apple-atlas.mjs");
			}
		} else {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, content);
		}
	}
	return { manifest, golden, script };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { manifest, golden } = await generateAppleAtlas({ check: process.argv.includes("--check") });
		console.log("Apple atlas " + (process.argv.includes("--check") ? "byte sync OK" : "generated") +
			": " + JSON.stringify(manifest.counts) + ", " + golden.cases.length + " canonical cases, " + manifest.inputSha256);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

