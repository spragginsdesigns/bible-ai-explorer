import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const welcome = readFileSync(resolve(process.cwd(), "src/features/chat/WelcomeState.tsx"), "utf8");
const normalized = welcome.replace(/\s+/g, " ");

describe("empty chat welcome copy", () => {
	it("leads with the companion promise and keeps Scripture as support", () => {
		expect(normalized).toContain('WELCOME_HEADLINE = "Come hungry for the Word."');
		expect(normalized).toContain(
			'WELCOME_SUBHEAD = "SureWord is your personal Bible study companion, shaped by your reading, questions, notes, and daily walk—helping you go deeper in Scripture every day."',
		);
		expect(normalized).toContain(
			'WELCOME_VERSE = "“As newborn babes, desire the sincere milk of the word, that ye may grow thereby:”"',
		);
		expect(normalized).toContain('WELCOME_VERSE_CITATION = "— 1 Peter 2:2, KJV"');
		expect(normalized).toContain(
			'WELCOME_TRUST = "Scripture comes first. Every answer is grounded in God\'s inerrant, infallible Word."',
		);

		const renderedWelcome = welcome.slice(welcome.indexOf("export function WelcomeState"));
		const headline = renderedWelcome.indexOf("{WELCOME_HEADLINE}");
		const subhead = renderedWelcome.indexOf("{WELCOME_SUBHEAD}");
		const verse = renderedWelcome.indexOf("{WELCOME_VERSE}");
		const trust = renderedWelcome.indexOf("{WELCOME_TRUST}");
		expect(headline).toBeGreaterThan(-1);
		expect(headline).toBeLessThan(subhead);
		expect(subhead).toBeLessThan(verse);
		expect(verse).toBeLessThan(trust);
		expect(welcome).not.toContain("2 PETER 1:19");
	});

	it("labels personalized suggestions and groups verse speech accessibly", () => {
		expect(welcome).toContain("CHOSEN FROM YOUR STUDY");
		expect(welcome).toContain('accessibilityRole="text"');
		expect(welcome).toContain("accessibilityLabel={`${WELCOME_VERSE} ${WELCOME_VERSE_CITATION}`}");
	});
});
