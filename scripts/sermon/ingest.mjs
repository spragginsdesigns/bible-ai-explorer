// Turn an FMBC live stream into a guided sermon study.
//
//   node scripts/sermon/ingest.mjs --latest
//   node scripts/sermon/ingest.mjs https://www.youtube.com/watch?v=43rbu63MQFY
//   node scripts/sermon/ingest.mjs --from-srt artifacts/sermons/43rbu63MQFY/service.srt \
//        --video-id 43rbu63MQFY --title "The Cost of Following"
//
// Flags:
//   --latest           newest upload on the channel that is not done yet
//   --from-srt <path>  skip download and transcription, compose from this SRT
//   --no-images        skip illustration (the slowest and only billed-by-image step)
//   --keep-audio       leave the .m4a behind (it is ~70 MB per service)
//   --out <dir>        output directory (default artifacts/sermons/<videoId>)
//   --model <id>       override the composing model
//
// Exits 75 (EX_TEMPFAIL) when YouTube has not finished turning the stream into
// a VOD, which is the normal state for a couple of hours after a service. A
// scheduled run should treat 75 as "try again shortly", not as a failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	composeStudy,
	discoverUploads,
	downloadAudio,
	generateImage,
	loadEnv,
	looksUnprocessed,
	model,
	parseSrt,
	renderMarkdown,
	segmentService,
	cuesBetween,
	formatTimestamp,
	transcribe,
	updateYtDlp,
	verifyStudy,
} from "./lib.mjs";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const FMBC_CHANNEL_ID = "UCiTssyWZc2PJ25OAZOaN7Ag";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_IMAGES = 4;
const TEMPFAIL = 75;

function parseArgs(argv) {
	const opts = {
		latest: false,
		rerender: false,
		fromSrt: null,
		images: true,
		keepAudio: false,
		out: null,
		model: DEFAULT_MODEL,
		videoId: null,
		title: null,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--latest") opts.latest = true;
		else if (a === "--no-images") opts.images = false;
		else if (a === "--keep-audio") opts.keepAudio = true;
		else if (a === "--rerender") opts.rerender = true;
		else if (a === "--from-srt") opts.fromSrt = argv[++i];
		else if (a === "--out") opts.out = argv[++i];
		else if (a === "--model") opts.model = argv[++i];
		else if (a === "--video-id") opts.videoId = argv[++i];
		else if (a === "--title") opts.title = argv[++i];
		else if (!a.startsWith("--")) opts.videoId = extractVideoId(a);
	}
	return opts;
}

function extractVideoId(input) {
	const m = String(input).match(/(?:v=|\/live\/|youtu\.be\/|\/watch\/)([\w-]{11})/);
	return m ? m[1] : /^[\w-]{11}$/.test(input) ? input : null;
}

const log = (msg) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const env = loadEnv(root);
	const apiKey = (env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
	if (!apiKey) throw new Error("OPENAI_API_KEY is required (env or .env.local).");

	let meta = { videoId: opts.videoId, title: opts.title, serviceDate: null };

	if (opts.latest) {
		const uploads = await discoverUploads(FMBC_CHANNEL_ID);
		const next = uploads.find((u) => !fs.existsSync(path.join(outDirFor(opts, u.videoId), "study.md")));
		if (!next) {
			log("nothing new on the channel.");
			return;
		}
		meta = { videoId: next.videoId, title: next.title, serviceDate: next.published?.slice(0, 10) ?? null };
		log(`latest unprocessed: ${meta.title} (${meta.videoId})`);
	}

	if (!meta.videoId) throw new Error("No video id. Pass a URL, an id, or --latest.");
	const outDir = outDirFor(opts, meta.videoId);
	fs.mkdirSync(outDir, { recursive: true });

	// ---- transcript -------------------------------------------------------
	const srtPath = opts.fromSrt ?? path.join(outDir, "service.srt");
	if (!fs.existsSync(srtPath)) {
		const audioPath = path.join(outDir, "service.m4a");
		if (!fs.existsSync(audioPath)) {
			log(`yt-dlp: ${await updateYtDlp()}`);
			log("downloading audio...");
			try {
				await downloadAudio(meta.videoId, audioPath);
			} catch (error) {
				if (looksUnprocessed(error.message)) {
					log("YouTube has not finished processing this stream yet; retry shortly.");
					process.exitCode = TEMPFAIL;
					return;
				}
				throw error;
			}
		}
		log(`transcribing ${(fs.statSync(audioPath).size / 1e6).toFixed(0)} MB on the GPU...`);
		const started = Date.now();
		await transcribe(audioPath, srtPath, env);
		log(`transcribed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
		if (!opts.keepAudio) fs.rmSync(audioPath, { force: true });
	} else {
		log(`using existing transcript ${path.relative(root, srtPath)}`);
	}

	const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
	if (!cues.length) throw new Error("The transcript has no cues.");
	log(`${cues.length} cues, ${formatTimestamp(cues[cues.length - 1].endMs)} of audio`);

	// Re-run the deterministic half (verification, rendering) against the
	// generation already on disk. Useful while tuning the renderer or the
	// honesty guards, and it bills nothing.
	const jsonPath = path.join(outDir, "study.json");
	let segment;
	let composed;
	if (opts.rerender) {
		if (!fs.existsSync(jsonPath)) throw new Error(`--rerender needs an existing ${jsonPath}`);
		const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
		segment = saved.segment;
		composed = saved.composed ?? saved.study;
		log("re-rendering the saved generation, no model calls");
	}

	// ---- find the sermon inside the service --------------------------------
	const m = model(env, opts.model);
	if (!segment) {
		log("locating the sermon...");
		segment = await segmentService(m, cues, { title: meta.title ?? "Service" });
	}
	const sermonCues = cuesBetween(cues, segment.sermonStartMs, segment.sermonEndMs);
	if (!sermonCues.length) throw new Error("Segmentation returned bounds with no cues inside.");
	const cut = Math.round((1 - sermonCues.length / cues.length) * 100);
	log(
		`sermon ${formatTimestamp(segment.sermonStartMs)} to ${formatTimestamp(
			segment.sermonEndMs
		)} (${sermonCues.length} cues, ${cut}% of the service set aside)`
	);
	if (segment.preachingText) log(`text: ${segment.preachingText}`);

	// ---- compose -----------------------------------------------------------
	if (!composed) {
		log("composing the study...");
		composed = await composeStudy(m, sermonCues, {
			root,
			title: meta.title ?? segment.serviceTitle,
			preachingText: segment.preachingText,
			preacher: segment.preacher,
		});
	}
	const study = verifyStudy(root, composed, sermonCues);
	const verified = study.sections.filter((s) => s.quoteVerified).length;
	log(`${study.sections.length} sections, ${verified} with a verbatim quote`);
	for (const r of study.repairedQuotes) log(`  repaired quote in "${r.heading}"`);
	for (const r of study.removedQuotes) log(`  withheld paraphrased quote in "${r.heading}"`);
	if (study.droppedReferences.length) {
		log(`dropped unverified references: ${study.droppedReferences.join(", ")}`);
	}

	// ---- illustrate --------------------------------------------------------
	if (opts.images) {
		const targets = study.sections.filter((s) => s.imagePrompt).slice(0, MAX_IMAGES);
		for (const [i, section] of targets.entries()) {
			const file = `image-${study.sections.indexOf(section) + 1}.png`;
			log(`illustrating ${i + 1}/${targets.length}: ${section.heading}`);
			try {
				await generateImage(apiKey, section.imagePrompt, path.join(outDir, file));
				section.imageFile = file;
			} catch (error) {
				log(`  image failed, continuing without it: ${error.message}`);
			}
		}
	}

	// ---- write -------------------------------------------------------------
	const finalMeta = {
		...meta,
		root,
		title: meta.title ?? segment.serviceTitle,
		preacher: segment.preacher,
		preachingText: segment.preachingText,
	};
	const markdown = renderMarkdown(study, finalMeta);
	fs.writeFileSync(path.join(outDir, "study.md"), markdown, "utf8");
	fs.writeFileSync(
		jsonPath,
		JSON.stringify({ meta: { ...finalMeta, root: undefined }, segment, composed, study }, null, 2),
		"utf8"
	);
	log(`wrote ${path.relative(root, path.join(outDir, "study.md"))}`);
}

function outDirFor(opts, videoId) {
	return opts.out ? path.resolve(root, opts.out) : path.join(root, "artifacts", "sermons", videoId);
}

main().catch((error) => {
	console.error(`\nFAILED: ${error.message}`);
	process.exitCode = 1;
});
