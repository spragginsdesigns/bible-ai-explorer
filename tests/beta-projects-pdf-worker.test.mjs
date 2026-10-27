/**
 * Study Projects reads uploaded PDFs on a worker thread the upload route can
 * terminate (LC-17680, docs/beta/projects.md). The worker only ships on Vercel
 * when three files agree on its chunk, and nothing in the build fails when
 * they drift apart: the route would answer 500 on every PDF in production.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

test("the upload route's trace includes the worker chunk extract.ts names", () => {
	const extract = read("src/lib/beta/projects/extract.ts");
	const config = read("next.config.mjs");
	const chunk = extract.match(/new Worker\(\/\* webpackChunkName: "([a-z-]+)" \*\/ new URL\("\.\/pdf-worker", import\.meta\.url\)/)?.[1];
	assert.equal(chunk, "pdf-worker", "extract.ts starts the worker from a literal URL with a named chunk");
	assert.ok(
		config.includes(`"/api/beta/projects/*/upload": [\`./\${distDir}/server/chunks/${chunk}.js\`]`),
		"next.config.mjs traces that chunk into the upload route",
	);
	assert.match(config, /if \(isServer && nextRuntime === "nodejs"\) config\.output\.workerPublicPath = "\.\/";/);
});

test("the worker keeps PDF.js inside its own chunk", () => {
	const worker = read("src/lib/beta/projects/pdf-worker.ts");
	assert.match(worker, /definePDFJSModule\(\(\) => import\(\/\* webpackMode: "eager" \*\/ "unpdf\/pdfjs"\)\)/);
	assert.doesNotMatch(read("src/lib/beta/projects/extract.ts"), /from "unpdf"/, "PDF.js never runs on the request's thread");
});
