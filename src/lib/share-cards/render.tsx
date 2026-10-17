import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import sharp from "sharp";
import { GLYPH_WIDTHS } from "./glyph-widths";
import {
	SHARE_CARD_PREVIEW_WIDTH,
	SHARE_CARD_SIZES,
	cardReferenceLabel,
	fitText,
	quoteScripture,
	type FitResult,
	type ShareCardSize,
	type ShareCardContent,
	type ShareCardFormat,
	type ShareCardStyle,
} from "./layout";

/**
 * Share cards: the drawing half (docs/FEATURES.md, "Share cards").
 *
 * One renderer serves every client. Android, web, macOS and iOS all ask the
 * server for the PNG and share that file, so a card looks the same wherever
 * it was made, and a change to how it looks ships with one deploy.
 *
 * The art is the app's own: the Judean dawn from the splash screen, the
 * parchment textures from the reader, and the gold day-star mark. Each is
 * pre-cropped to every card size in src/assets/share-cards (satori embeds
 * images whole, so a 1024x1536 source would be decoded and scaled on every
 * request), and read from disk once per server instance. Fonts are the
 * app's three faces, subset to Latin so satori parses 50 KB, not 700 KB.
 *
 * Sizes come from `fitText` in layout.ts; this file never guesses one.
 */

const ASSET_DIR = join(process.cwd(), "src", "assets", "share-cards");

type FontWeight = 400 | 500 | 600 | 700;
interface CardFont {
	name: string;
	data: ArrayBuffer;
	weight: FontWeight;
	style: "normal" | "italic";
}

const FONT_FILES: { file: string; name: string; weight: FontWeight; style: "normal" | "italic" }[] = [
	{ file: "CormorantGaramond_500Medium.ttf", name: "Cormorant", weight: 500, style: "normal" },
	{ file: "CormorantGaramond_500Medium_Italic.ttf", name: "Cormorant", weight: 500, style: "italic" },
	{ file: "CormorantGaramond_600SemiBold.ttf", name: "Cormorant", weight: 600, style: "normal" },
	{ file: "AtkinsonHyperlegible_400Regular.ttf", name: "Atkinson", weight: 400, style: "normal" },
	{ file: "AtkinsonHyperlegible_700Bold.ttf", name: "Atkinson", weight: 700, style: "normal" },
	{ file: "PirataOne_400Regular.ttf", name: "Pirata", weight: 400, style: "normal" },
];

let fontsPromise: Promise<CardFont[]> | null = null;
const imageCache = new Map<string, Promise<string>>();

function loadFonts(): Promise<CardFont[]> {
	fontsPromise ??= Promise.all(
		FONT_FILES.map(async (font) => {
			const buffer = await readFile(join(ASSET_DIR, "fonts", font.file));
			const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
			return { name: font.name, data, weight: font.weight, style: font.style };
		})
	).catch((error: unknown) => {
		// A failed read must not poison every later request on this instance.
		fontsPromise = null;
		throw error;
	});
	return fontsPromise;
}

function loadImage(file: string): Promise<string> {
	let cached = imageCache.get(file);
	if (!cached) {
		const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
		cached = readFile(join(ASSET_DIR, file))
			.then((buffer) => `data:${mime};base64,${buffer.toString("base64")}`)
			.catch((error: unknown) => {
				imageCache.delete(file);
				throw error;
			});
		imageCache.set(file, cached);
	}
	return cached;
}

/** How a style looks. Geometry lives in `GEOMETRY`. */
interface Palette {
	text: string;
	muted: string;
	accent: string;
	rule: string;
	questionFill: string;
	questionBorder: string;
	wordmark: string;
	/** Lifts text off a photograph; the flat grounds need none. */
	textShadow?: string;
}

const PALETTES: Record<ShareCardStyle, Palette> = {
	// Ivory on the dawn painting, with the honey gold of the mark.
	dawn: {
		text: "#f7f0e2",
		muted: "rgba(247, 240, 226, 0.72)",
		accent: "#ecc678",
		rule: "rgba(236, 198, 120, 0.7)",
		questionFill: "rgba(12, 11, 9, 0.46)",
		questionBorder: "rgba(236, 198, 120, 0.42)",
		wordmark: "#f7f0e2",
		textShadow: "0 2px 14px rgba(0, 0, 0, 0.55)",
	},
	// Iron-gall ink on parchment; the reference in the rubric red old Bibles
	// printed their headings in.
	parchment: {
		text: "#2a1b0c",
		muted: "rgba(42, 27, 12, 0.8)",
		accent: "#8a2316",
		rule: "rgba(138, 35, 22, 0.55)",
		questionFill: "rgba(255, 246, 222, 0.38)",
		questionBorder: "rgba(138, 35, 22, 0.35)",
		wordmark: "#3a2512",
	},
	// The app's own charcoal, lit by the day star.
	sanctuary: {
		text: "#f1e9d8",
		muted: "rgba(241, 233, 216, 0.66)",
		accent: "#e5b664",
		rule: "rgba(229, 182, 100, 0.6)",
		questionFill: "rgba(229, 182, 100, 0.08)",
		questionBorder: "rgba(229, 182, 100, 0.34)",
		wordmark: "#f1e9d8",
	},
};

/**
 * Where things sit on each canvas, in pixels. `textTop` is where the text
 * band starts for each style: below the sun on the dawn painting, below the
 * glowing mark in the sanctuary, just inside the scroll on parchment.
 */
interface Geometry {
	padX: number;
	/** Parchment's sits below the rolled edge of the scroll. */
	eyebrowTop: Record<ShareCardStyle, number>;
	textTop: Record<ShareCardStyle, number>;
	/** Space kept clear at the bottom for the wordmark. */
	footer: number;
	verseSizes: readonly number[];
	proseSizes: readonly number[];
	headlineSizes: readonly number[];
	questionSizes: readonly number[];
	referenceSize: number;
	eyebrowSize: number;
	markSize: number;
	wordmarkSize: number;
	/** The sanctuary's large glowing mark. */
	heroMark: number;
	heroMarkTop: number;
	/** Where a long passage starts once the sanctuary gives up its mark. */
	compactTop: number;
	gap: number;
}

const GEOMETRY: Record<ShareCardFormat, Geometry> = {
	story: {
		padX: 104,
		eyebrowTop: { dawn: 150, parchment: 250, sanctuary: 150 },
		textTop: { dawn: 860, parchment: 330, sanctuary: 640 },
		footer: 200,
		verseSizes: [112, 104, 96, 88, 82, 76, 70, 64, 60, 56, 52, 48, 44, 41, 38, 35, 32, 30, 28],
		proseSizes: [46, 43, 40, 37, 34, 32, 30],
		headlineSizes: [72, 66, 60, 56, 52, 48, 44],
		questionSizes: [46, 42, 39, 36, 33, 30],
		referenceSize: 34,
		eyebrowSize: 27,
		markSize: 58,
		wordmarkSize: 46,
		heroMark: 250,
		heroMarkTop: 250,
		compactTop: 200,
		gap: 44,
	},
	square: {
		padX: 92,
		eyebrowTop: { dawn: 84, parchment: 96, sanctuary: 84 },
		textTop: { dawn: 400, parchment: 150, sanctuary: 300 },
		footer: 130,
		verseSizes: [84, 78, 72, 66, 60, 56, 52, 48, 44, 41, 38, 35, 32, 30, 28, 26, 24],
		proseSizes: [38, 35, 32, 30, 28, 26],
		headlineSizes: [56, 52, 48, 44, 40, 36],
		questionSizes: [36, 33, 30, 28, 26],
		referenceSize: 28,
		eyebrowSize: 23,
		markSize: 46,
		wordmarkSize: 38,
		heroMark: 150,
		heroMarkTop: 92,
		compactTop: 100,
		gap: 30,
	},
	wide: {
		padX: 84,
		eyebrowTop: { dawn: 56, parchment: 60, sanctuary: 56 },
		textTop: { dawn: 120, parchment: 110, sanctuary: 120 },
		footer: 96,
		verseSizes: [60, 56, 52, 48, 44, 41, 38, 35, 32, 30, 28, 26, 24, 22],
		proseSizes: [32, 30, 28, 26, 24, 22],
		headlineSizes: [44, 40, 37, 34, 31, 28],
		questionSizes: [28, 26, 24, 22],
		referenceSize: 22,
		eyebrowSize: 20,
		markSize: 38,
		wordmarkSize: 32,
		heroMark: 0,
		heroMarkTop: 0,
		compactTop: 70,
		gap: 22,
	},
};

const SCRIPTURE_LINE_HEIGHT = 1.3;
const PROSE_LINE_HEIGHT = 1.42;
const QUESTION_LINE_HEIGHT = 1.32;
const REFERENCE_SPACING = 0.2;

function overlay(style: ShareCardStyle, format: ShareCardFormat): string {
	if (style === "dawn") {
		// Clouds stay soft at the top, the sun stays bright, and the hills
		// below darken into a quiet ground for the words.
		return format === "wide"
			? "linear-gradient(90deg, rgba(8,8,6,0.9) 0%, rgba(8,8,6,0.82) 55%, rgba(8,8,6,0.45) 100%)"
			: format === "square"
				? "linear-gradient(180deg, rgba(10,9,7,0.55) 0%, rgba(10,9,7,0.1) 18%, rgba(10,9,7,0.05) 28%, rgba(8,8,6,0.62) 44%, rgba(8,8,6,0.88) 62%, rgba(8,8,6,0.94) 100%)"
				: "linear-gradient(180deg, rgba(10,9,7,0.62) 0%, rgba(10,9,7,0.12) 16%, rgba(10,9,7,0) 30%, rgba(8,8,6,0.5) 42%, rgba(8,8,6,0.86) 56%, rgba(8,8,6,0.94) 100%)";
	}
	if (style === "sanctuary") {
		return format === "wide"
			? "radial-gradient(circle at 88% 50%, rgba(229,182,100,0.22) 0%, rgba(229,182,100,0) 40%), linear-gradient(180deg, rgba(10,10,9,0.55) 0%, rgba(10,10,9,0.7) 100%)"
			: "radial-gradient(circle at 50% 18%, rgba(229,182,100,0.3) 0%, rgba(229,182,100,0.08) 26%, rgba(229,182,100,0) 44%), linear-gradient(180deg, rgba(10,10,9,0.35) 0%, rgba(10,10,9,0.62) 100%)";
	}
	// Parchment: a faint warm vignette keeps the ink from floating.
	return "radial-gradient(circle at 50% 48%, rgba(255,244,214,0.28) 0%, rgba(255,244,214,0) 70%)";
}

interface Measured {
	headline: FitResult | null;
	body: FitResult;
	question: FitResult | null;
	/** The encouragement line under a verse card's reference. */
	word: FitResult | null;
}

/**
 * Budget the text band. The question (and an answer's headline) take what
 * they need first, within a cap, and the main text gets the rest.
 */
function measure(
	content: ShareCardContent,
	format: ShareCardFormat,
	style: ShareCardStyle,
	bandTop: number
): Measured {
	const { width, height } = SHARE_CARD_SIZES[format];
	const g = GEOMETRY[format];
	const textWidth = width - g.padX * 2;
	// gap, the 2px rule, the rule-to-label gap, and the label line.
	const referenceBlock = g.gap + 2 + Math.round(g.gap * 0.55) + g.referenceSize * 1.4;
	const ornament = style === "parchment" && content.kind !== "answer" ? ornamentSize(g) * 0.75 + g.gap * 0.6 : 0;
	let band = height - footerSpace(content, g, footerRise(style, format)) - bandTop - referenceBlock - ornament;

	let question: FitResult | null = null;
	if (content.kind === "cross" && content.question) {
		const innerWidth = textWidth - (format === "wide" ? 44 : 72);
		question = fitText({
			text: content.question,
			table: GLYPH_WIDTHS.verseItalic,
			maxWidth: innerWidth,
			maxHeight: band * 0.3,
			sizes: g.questionSizes,
			lineHeight: QUESTION_LINE_HEIGHT,
		});
		const labelHeight = g.eyebrowSize * 1.3 + 14;
		// Padding on both sides plus the 2px border top and bottom.
		const boxPadding = (format === "wide" ? 32 : 60) + 4;
		band -= question.lines * question.fontSize * QUESTION_LINE_HEIGHT + labelHeight + boxPadding + g.gap;
	}

	let headline: FitResult | null = null;
	if (content.kind === "answer") {
		headline = fitText({
			text: `“${content.question}”`,
			table: GLYPH_WIDTHS.verseItalic,
			// One glyph narrower, so a clipped question has room for the closing
			// quotation mark added after fitting.
			maxWidth: textWidth - g.headlineSizes[0] * 0.5,
			maxHeight: band * 0.36,
			sizes: g.headlineSizes,
			lineHeight: QUESTION_LINE_HEIGHT,
		});
		// A clipped question keeps its closing quotation mark.
		if (headline.truncated) headline = { ...headline, text: `${headline.text}”` };
		band -= headline.lines * headline.fontSize * QUESTION_LINE_HEIGHT + g.gap;
		const body = fitText({
			text: content.excerpt,
			table: GLYPH_WIDTHS.body,
			maxWidth: textWidth,
			maxHeight: band,
			sizes: g.proseSizes,
			lineHeight: PROSE_LINE_HEIGHT,
		});
		return { headline, body, question, word: null };
	}

	// The encouragement takes what it needs first, within a cap; Scripture
	// keeps the rest and is never the one that gives way.
	let word: FitResult | null = null;
	if (content.kind === "verse" && content.encouragement) {
		word = fitText({
			text: content.encouragement,
			table: GLYPH_WIDTHS.verseItalic,
			maxWidth: textWidth,
			maxHeight: band * 0.22,
			sizes: g.questionSizes,
			lineHeight: QUESTION_LINE_HEIGHT,
		});
		band -= word.lines * word.fontSize * QUESTION_LINE_HEIGHT + g.gap;
	}

	const body = fitText({
		text: quoteScripture(content.text),
		table: GLYPH_WIDTHS.verse,
		maxWidth: textWidth,
		maxHeight: band,
		sizes: g.verseSizes,
		lineHeight: SCRIPTURE_LINE_HEIGHT,
	});
	return { headline, body, question, word };
}

/**
 * Thomas Nelson's notice for the NKJV, which is still in copyright: their
 * free-use terms ask for it wherever their text is published, and a card is
 * published. KJV and BSB are public domain and carry none.
 */
const NKJV_NOTICE =
	"Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission.";

function footnoteFor(content: ShareCardContent): string | null {
	return content.kind !== "answer" && content.translation === "NKJV" ? NKJV_NOTICE : null;
}

function footnoteSize(g: Geometry): number {
	return Math.round(g.eyebrowSize * 0.78);
}

/** The bottom space the text band must leave: the wordmark, and any notice above it. */
function footerSpace(content: ShareCardContent, g: Geometry, rise: number): number {
	return rise + (footnoteFor(content) ? g.footer + footnoteSize(g) * 1.35 * 2 + 12 : g.footer);
}

/**
 * The parchment story is a scroll whose bottom edge is rolled and dark; the
 * wordmark and the door sit above it there, where the ink can be read.
 */
function footerRise(style: ShareCardStyle, format: ShareCardFormat): number {
	return style === "parchment" && format === "story" ? 150 : 0;
}

/** How far the wordmark rises to make room for the door line beneath it. */
function doorLift(g: Geometry): number {
	return Math.round(g.eyebrowSize * 1.1);
}

/**
 * A verse card whose passage does not fit even at the smallest size. Clipping
 * it would print a reference for words the card does not show, so the route
 * answers 422 and the client suggests a taller size or fewer verses. Answers
 * are excerpts by nature and never raise this.
 */
export class CardTooLongError extends Error {
	constructor() {
		super("This passage is too long for this card size. Try another size, or choose fewer verses.");
		this.name = "CardTooLongError";
	}
}

/**
 * Scripture never gives way to the encouragement line: when the line would
 * leave a long passage too little room, the card is measured again without
 * it, and only a passage too long on its own is refused.
 */
function measureScriptureFirst(
	content: ShareCardContent,
	format: ShareCardFormat,
	style: ShareCardStyle,
	bandTop: number
): Measured {
	const measured = measure(content, format, style, bandTop);
	if (content.kind === "verse" && content.encouragement && measured.body.truncated) {
		return measure({ ...content, encouragement: null }, format, style, bandTop);
	}
	return measured;
}

/** Below this, the sanctuary's mark is worth less than the words' size. */
const COMPACT_BELOW: Record<ShareCardFormat, number> = { story: 48, square: 38, wide: 0 };

interface CardPlan {
	bandTop: number;
	showHeroMark: boolean;
	measured: Measured;
}

/**
 * Where the text band starts. Every style has its own resting place; the
 * sanctuary's large mark steps aside for a passage that would otherwise
 * set too small to read on a phone.
 */
function plan(content: ShareCardContent, format: ShareCardFormat, style: ShareCardStyle, hasEyebrow: boolean): CardPlan {
	const g = GEOMETRY[format];
	const heroMark = style === "sanctuary" && format !== "wide" && !hasEyebrow;
	// A card with an eyebrow never lets the text band start inside it.
	const eyebrowBottom = hasEyebrow ? g.eyebrowTop[style] + eyebrowHeight(g) + g.gap : 0;
	const bandTop = Math.max(g.textTop[style], eyebrowBottom);
	const measured = measureScriptureFirst(content, format, style, bandTop);
	if (heroMark && measured.body.fontSize < COMPACT_BELOW[format]) {
		const compactTop = g.compactTop;
		return { bandTop: compactTop, showHeroMark: false, measured: measureScriptureFirst(content, format, style, compactTop) };
	}
	return { bandTop, showHeroMark: heroMark, measured };
}

function eyebrowHeight(g: Geometry): number {
	return g.eyebrowSize * 1.3 + 10 + Math.round(g.eyebrowSize * 1.55) * 1.3;
}

function ornamentSize(g: Geometry): number {
	return Math.round(g.referenceSize * 0.9);
}

/**
 * A rubricator's mark above parchment Scripture: a small diamond between two
 * hairlines. Drawn, not typed: satori renders the fleuron glyphs (❦ and
 * friends) as emoji.
 */
function Ornament({ palette, g }: { palette: Palette; g: Geometry }) {
	const size = ornamentSize(g);
	const line = Math.round(size * 2.2);
	return (
		<div style={{ display: "flex", alignItems: "center", marginBottom: Math.round(g.gap * 0.6) }}>
			<div style={{ display: "flex", width: line, height: 2, backgroundColor: palette.rule }} />
			<div
				style={{
					display: "flex",
					width: Math.round(size * 0.5),
					height: Math.round(size * 0.5),
					margin: `0 ${Math.round(size * 0.55)}px`,
					backgroundColor: palette.accent,
					transform: "rotate(45deg)",
				}}
			/>
			<div style={{ display: "flex", width: line, height: 2, backgroundColor: palette.rule }} />
		</div>
	);
}

function Eyebrow({ text, palette, size }: { text: string; palette: Palette; size: number }) {
	return (
		<div
			style={{
				display: "flex",
				fontFamily: "Atkinson",
				fontWeight: 700,
				fontSize: size,
				letterSpacing: size * 0.24,
				color: palette.accent,
				textTransform: "uppercase",
			}}
		>
			{text}
		</div>
	);
}

function Rule({ palette, width }: { palette: Palette; width: number }) {
	return <div style={{ display: "flex", width, height: 2, backgroundColor: palette.rule }} />;
}

/**
 * The text column. `align` is center for portrait cards and start for the
 * wide unfurl, where the words sit left of the light.
 */
function CardText({
	content,
	measured,
	palette,
	g,
	align,
	ornament,
}: {
	content: ShareCardContent;
	measured: Measured;
	palette: Palette;
	g: Geometry;
	align: "center" | "flex-start";
	ornament: boolean;
}) {
	const textAlign = align === "center" ? "center" : "left";
	const reference =
		content.kind === "answer"
			? content.reference
			: `${cardReferenceLabel(content.reference)}  ·  ${content.translation}`;

	return (
		<div style={{ display: "flex", flexDirection: "column", alignItems: align, width: "100%" }}>
			{ornament ? <Ornament palette={palette} g={g} /> : null}
			{measured.headline ? (
				<div
					style={{
						display: "flex",
						fontFamily: "Cormorant",
						fontStyle: "italic",
						fontWeight: 500,
						fontSize: measured.headline.fontSize,
						lineHeight: QUESTION_LINE_HEIGHT,
						color: palette.accent,
						textAlign,
						marginBottom: g.gap,
					}}
				>
					{measured.headline.text}
				</div>
			) : null}

			<div
				style={{
					display: "flex",
					fontFamily: content.kind === "answer" ? "Atkinson" : "Cormorant",
					fontWeight: content.kind === "answer" ? 400 : 500,
					fontSize: measured.body.fontSize,
					lineHeight: content.kind === "answer" ? PROSE_LINE_HEIGHT : SCRIPTURE_LINE_HEIGHT,
					color: palette.text,
					textAlign,
				}}
			>
				{measured.body.text}
			</div>

			{reference ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: align,
						marginTop: g.gap,
					}}
				>
					<Rule palette={palette} width={Math.round(g.referenceSize * 2.4)} />
					<div
						style={{
							display: "flex",
							marginTop: Math.round(g.gap * 0.55),
							fontFamily: "Atkinson",
							fontWeight: 700,
							fontSize: g.referenceSize,
							letterSpacing: g.referenceSize * REFERENCE_SPACING,
							color: palette.accent,
							textTransform: "uppercase",
						}}
					>
						{reference}
					</div>
				</div>
			) : null}

			{measured.word ? (
				<div
					style={{
						display: "flex",
						marginTop: g.gap,
						fontFamily: "Cormorant",
						fontStyle: "italic",
						fontWeight: 500,
						fontSize: measured.word.fontSize,
						lineHeight: QUESTION_LINE_HEIGHT,
						color: palette.text,
						opacity: 0.92,
						textAlign,
					}}
				>
					{measured.word.text}
				</div>
			) : null}

			{measured.question ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: align,
						width: "100%",
						marginTop: g.gap,
						padding: g.padX > 90 ? "30px 36px" : "16px 22px",
						borderRadius: 22,
						border: `2px solid ${palette.questionBorder}`,
						backgroundColor: palette.questionFill,
					}}
				>
					<div
						style={{
							display: "flex",
							fontFamily: "Atkinson",
							fontWeight: 700,
							fontSize: g.eyebrowSize,
							letterSpacing: g.eyebrowSize * 0.24,
							color: palette.accent,
							marginBottom: 14,
						}}
					>
						CARRY THIS
					</div>
					<div
						style={{
							display: "flex",
							fontFamily: "Cormorant",
							fontStyle: "italic",
							fontWeight: 500,
							fontSize: measured.question.fontSize,
							lineHeight: QUESTION_LINE_HEIGHT,
							color: palette.text,
							textAlign,
						}}
					>
						{measured.question.text}
					</div>
				</div>
			) : null}
		</div>
	);
}

function eyebrowFor(content: ShareCardContent): { title: string; subtitle: string | null } | null {
	if (content.kind === "cross") return { title: "Pick Up Your Cross", subtitle: content.dateLabel };
	if (content.kind === "answer") return { title: "Asked on SureWord", subtitle: null };
	return null;
}

function Wordmark({ mark, palette, g }: { mark: string; palette: Palette; g: Geometry }) {
	return (
		<div style={{ display: "flex", alignItems: "center" }}>
			{/* eslint-disable-next-line @next/next/no-img-element -- satori draws <img>, not next/image */}
			<img src={mark} width={g.markSize} height={g.markSize} alt="" style={{ marginRight: 16 }} />
			<div
				style={{
					display: "flex",
					fontFamily: "Pirata",
					fontSize: g.wordmarkSize,
					color: palette.wordmark,
					letterSpacing: 1,
				}}
			>
				SureWord
			</div>
		</div>
	);
}

export interface RenderOptions {
	style: ShareCardStyle;
	format: ShareCardFormat;
	/** "preview" scales the card down for the share sheet's live preview. */
	size?: ShareCardSize;
	cacheControl: string;
}

/**
 * Draw a card and answer it as a JPEG.
 *
 * satori only writes PNG, and a PNG of a painting is 2-4 MB: slow to load in
 * the sheet over a phone connection, and recompressed by every chat app
 * anyway. sharp re-encodes it as a high-quality JPEG with full-resolution
 * colour (4:4:4), so gold text on a dark ground stays crisp.
 */
export async function renderShareCard(content: ShareCardContent, options: RenderOptions): Promise<Response> {
	const png = await renderPng(content, options.style, options.format);
	let pipeline = sharp(png);
	if (options.size === "preview") pipeline = pipeline.resize({ width: SHARE_CARD_PREVIEW_WIDTH });
	const jpeg = await pipeline
		.jpeg({ quality: options.size === "preview" ? 80 : 90, chromaSubsampling: "4:4:4", mozjpeg: true })
		.toBuffer();
	return new Response(new Uint8Array(jpeg), {
		headers: {
			"content-type": "image/jpeg",
			"content-length": String(jpeg.byteLength),
			"cache-control": options.cacheControl,
		},
	});
}

async function renderPng(content: ShareCardContent, style: ShareCardStyle, format: ShareCardFormat): Promise<Buffer> {
	const { width, height } = SHARE_CARD_SIZES[format];
	const g = GEOMETRY[format];
	const palette = PALETTES[style];
	const [fonts, background, mark] = await Promise.all([
		loadFonts(),
		loadImage(`${style}-${format}.jpg`),
		loadImage("mark.png"),
	]);
	const eyebrow = eyebrowFor(content);
	const { bandTop, showHeroMark, measured } = plan(content, format, style, eyebrow !== null);
	if (content.kind !== "answer" && measured.body.truncated) throw new CardTooLongError();
	const footnote = footnoteFor(content);
	const door = content.kind === "answer" ? null : content.door;
	const rise = footerRise(style, format);
	// Scripture is centred like an inscription; an answer is prose, and
	// centred prose is hard to read, so answers (and the wide unfurl) set left.
	const align = format === "wide" || content.kind === "answer" ? "flex-start" : "center";
	const ornament = style === "parchment" && content.kind !== "answer";

	const layers: ReactElement = (
		<div
			style={{
				width,
				height,
				display: "flex",
				position: "relative",
				backgroundColor: style === "parchment" ? "#d9bf86" : "#0b0b0a",
				...(palette.textShadow ? { textShadow: palette.textShadow } : {}),
			}}
		>
			{/* eslint-disable-next-line @next/next/no-img-element -- satori draws <img>, not next/image */}
			<img src={background} width={width} height={height} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
			<div
				style={{
					display: "flex",
					position: "absolute",
					top: 0,
					left: 0,
					width,
					height,
					backgroundImage: overlay(style, format),
				}}
			/>

			{showHeroMark ? (
				<div
					style={{
						display: "flex",
						position: "absolute",
						top: g.heroMarkTop,
						left: (width - g.heroMark) / 2,
					}}
				>
					{/* eslint-disable-next-line @next/next/no-img-element -- satori draws <img>, not next/image */}
					<img src={mark} width={g.heroMark} height={g.heroMark} alt="" />
				</div>
			) : null}

			{eyebrow ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: align,
						position: "absolute",
						top: g.eyebrowTop[style],
						left: g.padX,
						width: width - g.padX * 2,
					}}
				>
					<Eyebrow text={eyebrow.title} palette={palette} size={g.eyebrowSize} />
					{eyebrow.subtitle ? (
						<div
							style={{
								display: "flex",
								marginTop: 10,
								fontFamily: "Cormorant",
								fontStyle: "italic",
								fontWeight: 500,
								fontSize: Math.round(g.eyebrowSize * 1.55),
								color: palette.muted,
							}}
						>
							{eyebrow.subtitle}
						</div>
					) : null}
				</div>
			) : null}

			<div
				style={{
					display: "flex",
					position: "absolute",
					top: bandTop,
					left: g.padX,
					width: width - g.padX * 2,
					height: height - bandTop - footerSpace(content, g, rise),
					flexDirection: "column",
					justifyContent: "center",
					alignItems: align,
				}}
			>
				<CardText
					content={content}
					measured={measured}
					palette={palette}
					g={g}
					align={align}
					ornament={ornament}
				/>
			</div>

			<div
				style={{
					display: "flex",
					position: "absolute",
					left: g.padX,
					bottom: rise + Math.round(g.footer * 0.36) + (door && format !== "wide" ? doorLift(g) : 0),
					width: width - g.padX * 2,
					justifyContent: format === "wide" ? "space-between" : "center",
					alignItems: "center",
				}}
			>
				{footnote ? (
					<div
						style={{
							display: "flex",
							position: "absolute",
							left: 0,
							bottom: g.markSize + 14,
							width: "100%",
							justifyContent: format === "wide" ? "flex-start" : "center",
							fontFamily: "Atkinson",
							fontSize: footnoteSize(g),
							lineHeight: 1.35,
							color: palette.muted,
							textAlign: format === "wide" ? "left" : "center",
						}}
					>
						{footnote}
					</div>
				) : null}
				<Wordmark mark={mark} palette={palette} g={g} />
				{format === "wide" ? (
					<div style={{ display: "flex", fontFamily: "Atkinson", fontSize: 22, color: palette.muted }}>
						{door ?? "sureword.app"}
					</div>
				) : null}
			</div>

			{/* The door: the passage's public page, where whoever receives the
			    card can read it in context and ask SureWord about it. */}
			{door && format !== "wide" ? (
				<div
					style={{
						display: "flex",
						position: "absolute",
						left: g.padX,
						bottom: rise + Math.round(g.footer * 0.16),
						width: width - g.padX * 2,
						justifyContent: "center",
						fontFamily: "Atkinson",
						fontSize: Math.round(g.eyebrowSize * 0.92),
						letterSpacing: 1,
						color: palette.muted,
					}}
				>
					{door}
				</div>
			) : null}
		</div>
	);

	const response = new ImageResponse(layers, { width, height, fonts });
	return Buffer.from(await response.arrayBuffer());
}
