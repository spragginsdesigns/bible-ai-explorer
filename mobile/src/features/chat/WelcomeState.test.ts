import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const welcome = readFileSync(resolve(root, "src/features/chat/WelcomeState.tsx"), "utf8");
const chatScreen = readFileSync(resolve(root, "app/(app)/index.tsx"), "utf8");
const normalized = welcome.replace(/\s+/g, " ");

describe("empty chat welcome", () => {
	it("keeps the approved headline and nothing else above the questions", () => {
		expect(normalized).toContain('WELCOME_HEADLINE = "Come hungry for the Word."');
		expect(welcome).toContain("{WELCOME_HEADLINE}");
		expect(welcome).toContain('<SureWordGuideAvatar variant="hero" size={96} />');

		// The pitch, the verse and the trust line moved to the signed-out
		// landing page; a signed-in user opens a chat tab, not a brochure.
		expect(welcome).not.toContain("WELCOME_SUBHEAD");
		expect(welcome).not.toContain("personal Bible study companion");
		expect(welcome).not.toContain("sincere milk");
		expect(welcome).not.toContain("1 Peter 2:2");
		expect(welcome).not.toContain("Scripture comes first");
		expect(welcome).not.toContain("2 PETER 1:19");
		expect(welcome).not.toContain("stained-glass");
		expect(welcome).not.toContain("ImageBackground");
		expect(existsSync(resolve(root, "assets/sureword-welcome-stained-glass.webp"))).toBe(false);
	});

	it("shows the first four questions with a reveal for the rest, in server order", () => {
		expect(welcome).toContain("CHOSEN FROM YOUR STUDY");
		expect(welcome).toContain("VISIBLE_QUESTION_COUNT = 4");
		expect(welcome).toContain("questionItems.slice(0, VISIBLE_QUESTION_COUNT)");
		expect(welcome).toContain("more from your study");
		expect(welcome).not.toContain("featuredQuestion");
	});

	it("leaves the composer to the screen, docked in every state", () => {
		expect(welcome).not.toContain("composer:");
		expect(welcome).not.toContain("{composer}");
		expect(chatScreen).not.toContain("composer={inputBar}");
		expect(chatScreen).not.toContain("{!showWelcome && (");
		expect(chatScreen).toContain("prominent={showWelcome}");
	});
});
