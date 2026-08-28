import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const component = readFileSync(
	resolve(root, "src/components/SureWordGuideAvatar.tsx"),
	"utf8",
);
const welcome = readFileSync(resolve(root, "src/features/chat/WelcomeState.tsx"), "utf8");
const chatMessage = readFileSync(resolve(root, "src/features/chat/MessageBubble.tsx"), "utf8");
const noteMessage = readFileSync(
	resolve(root, "src/features/notes/components/NoteAIMessage.tsx"),
	"utf8",
);
const assetPath = resolve(root, "assets/sureword-guide.png");

describe("SureWord guide avatar contract", () => {
	it("ships one real RGBA artwork asset at production resolution", () => {
		expect(existsSync(assetPath)).toBe(true);
		expect(statSync(assetPath).size).toBeGreaterThan(100_000);

		const png = readFileSync(assetPath);
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		expect(png.readUInt32BE(16)).toBe(768);
		expect(png.readUInt32BE(20)).toBe(768);
		// PNG color type 6 is truecolor with an alpha channel.
		expect(png[25]).toBe(6);
	});

	it("animates the hero and active replies while respecting Reduce Motion", () => {
		expect(component).toContain("variant === \"hero\" || active");
		expect(component).toContain("AccessibilityInfo.isReduceMotionEnabled()");
		expect(component).toContain("\"reduceMotionChanged\"");
		expect(component).toContain('require("../../assets/sureword-guide.png")');
	});

	it("uses the shared identity everywhere the mobile AI speaks", () => {
		expect(welcome).toContain('<SureWordGuideAvatar variant="hero" size={154} />');
		expect(chatMessage).toContain(
			'<SureWordGuideAvatar active={Boolean(message.isStreaming)} />',
		);
		expect(noteMessage).toContain(
			'<SureWordGuideAvatar size={26} active={Boolean(message.isStreaming)} />',
		);
		expect(chatMessage).not.toContain("avatarGlyph");
		expect(noteMessage).not.toContain("avatarGlyph");
	});
});
