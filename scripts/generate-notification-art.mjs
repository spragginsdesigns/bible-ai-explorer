#!/usr/bin/env node
/**
 * Generate the notification artwork for the Daily Cross and "Your answer is
 * ready", then cut every platform's copy from the same four masters.
 *
 *   node scripts/generate-notification-art.mjs            # generate + derive
 *   node scripts/generate-notification-art.mjs --derive   # derive from existing masters
 *
 * Masters land in .logo-work/notifications/ (gitignored). Derived files:
 *   - Android  mobile/modules/sureword-notifications/android/src/main/res/drawable-nodpi/
 *              sureword_notif_<kind>_{mark,wide}.webp, pre-rounded because
 *              RemoteViews cannot clip corners
 *   - Web      public/notifications/<kind>-{mark,wide}.jpg (push icon/image)
 *   - Apple    macos/Shared/NotificationArt/<kind>-{mark,wide}.jpg (attachment
 *              thumbnail and the content extension's banner)
 *
 * Needs ImageMagick 7 (`magick`) on PATH. OPENAI_API_KEY comes from the
 * environment or .env.local, never from source.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTERS = path.join(ROOT, ".logo-work", "notifications");
const ANDROID = path.join(ROOT, "mobile/modules/sureword-notifications/android/src/main/res/drawable-nodpi");
const WEB = path.join(ROOT, "public/notifications");
const APPLE = path.join(ROOT, "macos/Shared/NotificationArt");

/** The small mark: read at 40dp beside the title, so no fine linework. */
const MARK = "Warm antique gold (#E8B44A) artwork on a solid near-black (#0A0A0A) square background. Bold, confident flat vector mark, strictly symmetrical, high contrast, generous even padding, centered. Must stay legible at 40 pixels: thick strokes, no fine linework. Absolutely no text, letters, words or numbers. Reverent, elegant, matching a Bible app icon of a morning star rising over an open book.";
/** The expanded banner: sits above the words, never behind them. */
const PHOTO = "Reverent, quiet, cinematic fine-art photograph. Palette: near-black #0a0a0a, warm gold and amber light, a little deep umber; no other colours. Soft, calm dark negative space on the left third for overlaid text, fine film grain. Absolutely no text, letters, words, numbers, writing, logos, watermark, people or faces.";

const JOBS = {
	"cross-mark": ["A simple bold Latin cross standing on a gentle hill, with a radiant eight-pointed morning star sunburst rising directly behind it, short clean rays fanning outward. " + MARK, "1024x1024"],
	"answer-mark": ["An open book seen from the front, and rising from its pages a rounded speech balloon outline made of warm light, with a small eight-pointed star inside the balloon. " + MARK, "1024x1024"],
	"cross-wide": ["Golden dawn breaking over dark rolling hills; on the farthest hill a small, simple wooden cross in silhouette, a single bright morning star just above it sending long soft rays across the sky. " + PHOTO, "1536x864"],
	"answer-wide": ["An old open Bible resting on a dark wooden table, its blank gilded page edges glowing in a soft shaft of warm golden light falling from the upper right, dust motes drifting like tiny stars. " + PHOTO, "1536x864"],
};

async function apiKey() {
	const envFile = path.join(ROOT, ".env.local");
	const key = process.env.OPENAI_API_KEY?.trim()
		|| (existsSync(envFile) ? parseEnv(await readFile(envFile, "utf8")).OPENAI_API_KEY?.trim() : "");
	if (!key) throw new Error("OPENAI_API_KEY is not set (environment or .env.local)");
	return key;
}

async function generate() {
	const key = await apiKey();
	await Promise.all(Object.entries(JOBS).map(async ([name, [prompt, size]]) => {
		const res = await fetch("https://api.openai.com/v1/images/generations", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ model: "gpt-image-2.5-sunburst", prompt, size, quality: "high", output_format: "png", n: 1 }),
		});
		if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
		await writeFile(path.join(MASTERS, `${name}.png`), Buffer.from((await res.json()).data[0].b64_json, "base64"));
		console.log("generated", name);
	}));
}

const magick = (...args) => execFileSync("magick", args, { stdio: "inherit" });

/** Cover-crop to w x h, then cut rounded corners into the alpha channel. */
function rounded(src, out, w, h, r) {
	magick(src, "-resize", `${w}x${h}^`, "-gravity", "center", "-extent", `${w}x${h}`,
		"(", "-size", `${w}x${h}`, "xc:none", "-fill", "white", "-draw", `roundrectangle 0,0 ${w - 1},${h - 1} ${r},${r}`, ")",
		"-alpha", "set", "-compose", "DstIn", "-composite", "-quality", "90", out);
}

function flat(src, out, geometry) {
	magick(src, "-resize", geometry, "-strip", "-quality", "85", out);
}

function derive() {
	for (const kind of ["cross", "answer"]) {
		const mark = path.join(MASTERS, `${kind}-mark.png`);
		const wide = path.join(MASTERS, `${kind}-wide.png`);
		rounded(mark, path.join(ANDROID, `sureword_notif_${kind}_mark.webp`), 192, 192, 40);
		rounded(wide, path.join(ANDROID, `sureword_notif_${kind}_wide.webp`), 960, 480, 36);
		flat(mark, path.join(WEB, `${kind}-mark.jpg`), "256x256");
		flat(wide, path.join(WEB, `${kind}-wide.jpg`), "1024x");
		flat(mark, path.join(APPLE, `${kind}-mark.jpg`), "300x300");
		flat(wide, path.join(APPLE, `${kind}-wide.jpg`), "1200x");
		console.log("derived", kind);
	}
}

await mkdir(MASTERS, { recursive: true });
if (!process.argv.includes("--derive")) await generate();
derive();
