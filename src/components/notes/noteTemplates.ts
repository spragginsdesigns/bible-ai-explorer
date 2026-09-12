/**
 * B7 note templates: a new note is never a blank rectangle. Each template is
 * a skeleton in the house style (N1) — first person, a descriptive title, a
 * few claim-style headings, the primary verse as a blockquote ending
 * "— Reference, KJV", and a closing "What I do next". Prompt lines are
 * italic scaffolding the writer replaces.
 *
 * Mirrored in mobile/src/features/notes/components/CreateItemSheet.tsx —
 * keep the wording identical when editing either copy.
 */

export type NoteTemplateId = "verse-study" | "sermon" | "prayer" | "blank";

export interface NoteTemplateSeed {
	title: string;
	html: string;
	plainText: string;
	wordCount: number;
}

export interface NoteTemplateOption {
	id: NoteTemplateId;
	label: string;
	description: string;
}

export const NOTE_TEMPLATE_OPTIONS: NoteTemplateOption[] = [
	{
		id: "verse-study",
		label: "Verse study",
		description: "One verse, what it says, what it means, what you do next.",
	},
	{
		id: "sermon",
		label: "Sermon notes",
		description: "Sunday's date and your church, the passage, the point to keep.",
	},
	{
		id: "prayer",
		label: "Prayer journal",
		description: "Thanks, requests, and the people you are praying for.",
	},
	{
		id: "blank",
		label: "Blank note",
		description: "Start from an empty page.",
	},
];

/** The most recent Sunday (today when today is Sunday). */
function lastSunday(now: Date): Date {
	const day = new Date(now);
	day.setDate(day.getDate() - day.getDay());
	return day;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function prompt(text: string): string {
	return `<p><em>${text}</em></p>`;
}

function buildHtml(id: Exclude<NoteTemplateId, "blank">, churchName: string | null, now: Date): string {
	switch (id) {
		case "verse-study":
			return [
				"<h2>The text</h2>",
				"<blockquote><p>Write the verse out in full. — Reference, KJV</p></blockquote>",
				"<h2>What it says</h2>",
				prompt("What the verse actually says, in my own words."),
				"<h2>What it means</h2>",
				prompt("What this teaches me about God, and about myself."),
				"<h2>The rest of Scripture on it</h2>",
				prompt("Cross-references that say the same thing."),
				"<h2>What I do next</h2>",
				prompt("One concrete thing this changes today."),
			].join("");
		case "sermon":
			return [
				...(churchName ? [prompt(`Church: ${churchName}`)] : []),
				"<h2>The passage</h2>",
				"<blockquote><p>The text the sermon preached. — Reference, KJV</p></blockquote>",
				"<h2>The preacher’s point</h2>",
				prompt("The one thing the sermon said."),
				"<h2>What I need to remember</h2>",
				prompt("The lines worth keeping."),
				"<h2>What I do next</h2>",
				prompt("How this sermon changes my week."),
			].join("");
		case "prayer":
			return [
				"<h2>What I thank God for</h2>",
				prompt("Name the mercies, specifically."),
				"<h2>What I ask</h2>",
				prompt("The requests, plainly."),
				"<h2>Who I pray for</h2>",
				prompt("The people, by name."),
				"<h2>What I do next</h2>",
				prompt("What faithfulness looks like while I wait."),
			].join("");
	}
}

function plainTextOf(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The seed for a template, or null for a blank note (today's behaviour).
 * `churchName` personalises the sermon template when the user has set a
 * church; the line is omitted otherwise.
 */
export function buildNoteTemplate(
	id: NoteTemplateId,
	options: { churchName?: string | null; now?: Date } = {}
): NoteTemplateSeed | null {
	if (id === "blank") return null;
	const now = options.now ?? new Date();
	const churchName = options.churchName ?? null;
	const title =
		id === "sermon"
			? `Sermon notes — ${formatDate(lastSunday(now))}`
			: id === "prayer"
				? `Prayer journal — ${formatDate(now)}`
				: "Verse study";
	const html = buildHtml(id, churchName, now);
	const plainText = plainTextOf(html);
	return {
		title,
		html,
		plainText,
		wordCount: plainText ? plainText.split(/\s+/).length : 0,
	};
}
