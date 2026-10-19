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

describe("SureWord guide avatar contract", () => {
	it.each(["idle", "thinking", "answering"])("ships the %s pose with consistent RGBA framing", (phase) => {
		const assetPath = resolve(root, `assets/chat-home/sureword-companion-${phase}.png`);
		expect(existsSync(assetPath)).toBe(true);
		expect(statSync(assetPath).size).toBeGreaterThan(100_000);

		const png = readFileSync(assetPath);
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		// 700x840 keeps the original 5:6 framing and is still sharp at the 192dp hero on a 4x screen.
		expect(png.readUInt32BE(16)).toBe(700);
		expect(png.readUInt32BE(20)).toBe(840);
		// PNG color type 6 is truecolor with an alpha channel.
		expect(png[25]).toBe(6);
	});

	it("animates the hero and active replies while respecting Reduce Motion", () => {
		expect(component).toContain("variant === \"hero\" || phase !== \"idle\"");
		expect(component).toContain("AccessibilityInfo.isReduceMotionEnabled()");
		expect(component).toContain("\"reduceMotionChanged\"");
		expect(component).toContain('"screenReaderChanged"');
		expect(component).toContain('AppState.addEventListener');
	});

	it("uses the shared identity everywhere the mobile AI speaks", () => {
		expect(welcome).toContain('<SureWordGuideAvatar variant="hero" size={190}');
		expect(chatMessage).toContain(
			'<SureWordGuideAvatar phase={guidePhase(Boolean(message.isStreaming), message.content)} />',
		);
		expect(noteMessage).toContain(
			'<SureWordGuideAvatar size={26} phase={guidePhase(Boolean(message.isStreaming), message.content)} />',
		);
		expect(chatMessage).not.toContain("avatarGlyph");
		expect(noteMessage).not.toContain("avatarGlyph");
	});
});
