import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory) {
	const absolute = join(root, directory);
	return readdirSync(absolute).flatMap((name) => {
		const path = join(absolute, name);
		if (statSync(path).isDirectory()) return sourceFiles(relative(root, path));
		return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
	});
}

test("web typography is Atkinson for body text and Hack for code", () => {
	const layout = read("src/app/layout.tsx");
	const globals = read("src/app/globals.css");
	const tailwind = read("tailwind.config.ts");

	assert.match(layout, /Atkinson_Hyperlegible/);
	assert.match(layout, /variable: "--font-body"/);
	assert.match(layout, /hack-regular\.woff2/);
	assert.match(layout, /variable: "--font-mono"/);
	assert.match(layout, /font-body text-body/);
	assert.match(globals, /font-family: var\(--font-body\), system-ui, sans-serif/);
	assert.match(tailwind, /chat: \["1\.0625rem", \{ lineHeight: "1\.75rem" \}\]/);
	assert.match(tailwind, /mono: \["var\(--font-mono\)", "Hack"/);
});

test("Android exposes the agreed readable scale and bundled families", () => {
	const theme = read("mobile/src/theme/index.ts");
	const rootLayout = read("mobile/app/_layout.tsx");

	assert.match(theme, /body: "AtkinsonHyperlegible_400Regular"/);
	assert.match(theme, /mono: "Hack_400Regular"/);
	assert.match(theme, /chat: \{ fontSize: 17, lineHeight: 28 \}/);
	assert.match(theme, /body: \{ fontSize: 16, lineHeight: 24 \}/);
	assert.match(theme, /meta: \{ fontSize: 13, lineHeight: 18 \}/);
	assert.match(rootLayout, /Hack_400Regular/);
	assert.match(rootLayout, /AtkinsonHyperlegible_400Regular/);
});

test("Android screens route all text through the shared primitives", () => {
	const offenders = [];
	for (const path of [...sourceFiles("mobile/app"), ...sourceFiles("mobile/src")]) {
		if (path.endsWith(join("components", "AppText.tsx"))) continue;
		const source = readFileSync(path, "utf8");
		for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"react-native";/g)) {
			if (/(?:^|,)\s*Text(?:Input)?\s*(?:,|$)/m.test(match[1])) {
				offenders.push(relative(root, path));
			}
		}
	}
	assert.deepEqual(offenders, []);
});

test("web components do not reintroduce explicit 10-12px text", () => {
	const offenders = [];
	for (const path of sourceFiles("src")) {
		const source = readFileSync(path, "utf8");
		if (/text-\[(?:10|11|12)px\]/.test(source)) offenders.push(relative(root, path));
	}
	assert.deepEqual(offenders, []);
});
