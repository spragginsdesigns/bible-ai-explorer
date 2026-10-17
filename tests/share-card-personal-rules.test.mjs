/* The words on a personal card ("Send a word", docs/FEATURES.md). These rules
 * stand between text a person typed and a SureWord-branded public page. */
import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanPersonalText,
	personalTextProblem,
	sharesWordRun,
	wordIsSafe,
} from "../src/lib/share-cards/personal-rules.ts";

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);

test("person-typed text loses invisible and direction-reversing characters", () => {
	assert.equal(cleanPersonalText(`Sa${ZWSP}rah`, 40), "Sa rah");
	assert.equal(cleanPersonalText(`${RLO}Austin`, 30), "Austin");
	assert.equal(cleanPersonalText("  Pray\n\tfor you  ", 40), "Pray for you");
	assert.equal(cleanPersonalText("x".repeat(50), 40)?.length, 40);
	assert.equal(cleanPersonalText("when you wake up", 14), "when you wake", "cut at a word, never inside one");
	assert.equal(cleanPersonalText(`${ZWSP}  `, 40), null);
	assert.equal(cleanPersonalText(42, 40), null);
});

test("a card can never speak as SureWord or carry a link or an address", () => {
	assert.ok(personalTextProblem("SureWord Team"));
	assert.ok(personalTextProblem("sure word"));
	assert.ok(personalTextProblem("Your gift is at https://example.com"));
	assert.ok(personalTextProblem("visit www.example.org"));
	assert.ok(personalTextProblem("go to prizes.app now"));
	assert.ok(personalTextProblem("write me at me@example.com"));
	assert.ok(personalTextProblem("Sure-Word"));
	assert.ok(personalTextProblem("SureWords Team"));
	assert.ok(personalTextProblem("CLAIM YOUR GIFT AT PRIZES.COM"));
	assert.ok(personalTextProblem("Visit Prizes.Com today"));
	assert.ok(personalTextProblem("go to example dot com"));
	assert.equal(personalTextProblem("Praying for you every hour. I love you."), null);
	// Plain English that only looks like the brand or a link.
	assert.equal(personalTextProblem("I'm sure words fail, but God is near."), null);
	assert.equal(personalTextProblem("We have a more sure word of prophecy."), null);
	assert.equal(personalTextProblem("Love you.Me and Dad are praying."), null);
	assert.equal(personalTextProblem("We are with you.Us too."), null);
	assert.equal(personalTextProblem("Austin"), null);
	assert.equal(personalTextProblem(null), null);
});

test("SureWord's word never echoes the private situation or carries a link", () => {
	const situation = "She has surgery tomorrow morning and is scared she will not wake up";
	assert.equal(sharesWordRun("The Lord will hold you tomorrow morning", situation), false);
	assert.equal(sharesWordRun("You will not wake up alone", situation), true, "four words in a row is an echo");
	assert.equal(sharesWordRun("scared she will not wake up", situation), true);
	assert.equal(wordIsSafe("Sarah, rest your heart in the Lord who holds you tomorrow.", situation), true);
	assert.equal(wordIsSafe("She has surgery tomorrow morning, but God is near.", situation), false);
	assert.equal(wordIsSafe("Visit example.com for comfort.", situation), false);
	assert.equal(wordIsSafe("SureWord is with you.", situation), false);
});
