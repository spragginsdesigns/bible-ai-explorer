import type { HelpScreen } from "@/lib/onboarding-rules";

/**
 * What each screen's "?" button covers. A help tap is an app question: the
 * answer is checked like any other, and without the app facts in front of
 * both the answering model and the reviewer, an accurate description of a
 * screen reads as invented detail and is withheld (2026-11-05).
 *
 * This lives outside src/utils/systemPrompt.ts on purpose: that file holds
 * the doctrinal foundation, and the build pins its hash
 * (scripts/generate-history-manifest.mjs) so it changes only by Austin's
 * decision.
 */
export const helpScreenGuidance: Record<HelpScreen, string> = {
	today: "Today, the first tab, headed SureWord: Pick Up Your Cross with \"Read today's word\", Continue reading (or Open your Bible), Learn a verse, their reading plan, Ways to Serve when they have it switched on, Your walk (their reading history and time in the Word), Send a word (share a verse for what someone is facing), and a Getting started card for new accounts.",
	bible: "the Bible reader: book and chapter pickers, quick-jump to a reference, previous and next chapter, adjustable text size, and tapping any verse for a short explanation with Copy, Share, Save to note, Expand with AI, highlight colours and Learn this verse.",
	chat: "Chat: asking anything about Scripture, attaching images, PDFs and text files, opening past conversations from history, starting a new conversation, and the quick slash commands such as /check, /verify, /reply, /note and /cross.",
	study: "Study: Notes (folders, tags, pinning, search and each note's AI panel), Bible timeline, People of the Bible, Places & atlas, Original languages (Hebrew, Greek and Strong's word studies), and Sermon studies with church announcements when their church's services are set up.",
	connections: "Connections: a map of how a verse ties to other passages across the Bible through cross-references. They go to a verse or chapter, step between chapters, choose a verse, and use \"Ask why these connect\" for an explanation of the thread between the passages.",
};

export function appHelpGuidance(screen: HelpScreen): string {
	return `APP HELP TURN: The user tapped the "?" help button on a SureWord screen, so this message was sent by the app, not typed. The screen covers ${helpScreenGuidance[screen]}
Answer as their guide to that screen in a few short sentences or a short list: what it is for and the two or three most useful things to do there, then ask what they would like to try first. Use only what this block and ABOUT SUREWORD describe, and call showInApp for the one place most worth showing. A screen needs no Bible citation to be explained; if you do quote a verse, quote it exactly.`;
}

/**
 * A turn's task blocks with the help-tap blocks in front when the message is
 * a recognised "?" tap (helpScreenForText). The route puts these in the
 * prepared system context, which the Scripture reviewer also reads, so both
 * models see the same app facts. appKnowledge (passed in, so this module
 * stays free of value imports) is never added twice.
 */
export function withAppHelpGuidance(blocks: readonly string[], screen: HelpScreen | null, appKnowledge: string): string[] {
	if (!screen) return [...blocks];
	return [appKnowledge, appHelpGuidance(screen), ...blocks.filter((block) => block !== appKnowledge)];
}
