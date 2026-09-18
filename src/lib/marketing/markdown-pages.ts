import { ANDROID_APK_URL, MACOS_DMG_URL } from "@/lib/constants";
import { LANDING_FAQ } from "@/lib/marketing/faq";
import {
	MEMBERSHIP_TERMS,
	PRIVACY_POLICY,
	type LegalDocument,
	type LegalInline,
} from "@/lib/marketing/legal-content";

/**
 * Markdown twins of the public pages (llmstxt.org: "<page>.md", root is
 * /index.md), served by src/app/{index,privacy,terms}.md/route.ts. Each one is
 * built from the same source the HTML page renders, so the two cannot drift.
 */

export const SITE_URL = "https://sureword.app";

// Same sentence as the landing page's APP_DESCRIPTION and the root layout's
// meta description (tests/welcome-copy-parity.test.mjs pins its wording).
const APP_DESCRIPTION =
	"Come hungry for the Word. SureWord is a KJV Bible study app and personal Bible study companion with AI. Ask any Bible question and get answers grounded in Scripture.";

// The doctrinal stance and download list shared by /llms.txt and /index.md.
export const KJV_STANCE =
	"SureWord holds the King James Version as the inerrant, infallible Word of God and answers from that conviction: it quotes and cites Scripture rather than reinterpreting it, and it does not present the Bible as one opinion among many. It is a study aid, not a replacement for reading the Bible or for a local church, and its AI can make mistakes.";

export function getTheAppSection(): string {
	return `## Get the app

- [Web app](${SITE_URL}): sign up free and study in any browser, including on iPhone, iPad and Windows.
- [Android app (APK)](${ANDROID_APK_URL}): the native Android app, always the latest release.
- [macOS app (DMG)](${MACOS_DMG_URL}): the native Mac app, always the latest release.`;
}

function absoluteHref(href: string): string {
	return href.startsWith("/") ? `${SITE_URL}${href === "/" ? "" : href}` : href;
}

function inlineMarkdown(content: LegalInline[]): string {
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if ("strong" in part) return `**${part.strong}**`;
			// A mailto link reads better as the bare address in plain markdown.
			return part.href.startsWith("mailto:")
				? `<${part.text}>`
				: `[${part.text}](${absoluteHref(part.href)})`;
		})
		.join("");
}

function legalMarkdown(doc: LegalDocument, htmlPath: string): string {
	const body = doc.blocks
		.map((block) => {
			if (block.type === "h2") return `## ${block.text}`;
			if (block.type === "ul") {
				return block.items.map((item) => `- ${inlineMarkdown(item)}`).join("\n");
			}
			return inlineMarkdown(block.content);
		})
		.join("\n\n");
	return `# ${doc.title}\n\n${doc.byline}\n\nHTML version: ${SITE_URL}${htmlPath}\n\n${body}\n`;
}

export function buildPrivacyMarkdown(): string {
	return legalMarkdown(PRIVACY_POLICY, "/privacy");
}

export function buildTermsMarkdown(): string {
	return legalMarkdown(MEMBERSHIP_TERMS, "/terms");
}

export function buildIndexMarkdown(): string {
	const faq = LANDING_FAQ.map(
		(item) => `### ${item.question}\n\n${item.answer}`,
	).join("\n\n");

	return `# SureWord

> ${APP_DESCRIPTION}

${KJV_STANCE} It is made by LineCrush Inc.

${getTheAppSection()}

## More

- [Site summary for AI assistants](${SITE_URL}/llms.txt)
- [Sign up](${SITE_URL}/sign-up)
- [Privacy policy](${SITE_URL}/privacy.md)
- [Terms of service](${SITE_URL}/terms.md)

## FAQ

${faq}
`;
}
