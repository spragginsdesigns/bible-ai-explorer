/** Identical template payloads on web and native. No user content is parsed as HTML. */
export type NoteTemplateId = "verse-study" | "sermon" | "prayer" | "blank";
export interface NoteTemplateSeed { title: string; content: string; html: string; plainText: string; wordCount: number }
export const NOTE_TEMPLATE_OPTIONS: { id: NoteTemplateId; label: string; description: string }[] = [
 { id: "verse-study", label: "Verse study", description: "One verse, what I learn, and how I obey." },
 { id: "sermon", label: "Sermon notes", description: "Sunday's date, my church, and what I need to remember." },
 { id: "prayer", label: "Prayer journal", description: "My thanks, requests, and the people I pray for." },
 { id: "blank", label: "Blank note", description: "Start from an empty page." },
];
type Block = { kind: "heading" | "prompt" | "quote"; text: string };
const heading = (text: string): Block => ({ kind: "heading", text });
const prompt = (text: string): Block => ({ kind: "prompt", text });
const quote = (text: string): Block => ({ kind: "quote", text });
function escapeHtml(text: string): string {
 return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function buildNoteTemplate(id: NoteTemplateId, options: { churchName?: string | null; now?: Date } = {}): NoteTemplateSeed | null {
 if (id === "blank") return null;
 const now = new Date(options.now ?? new Date());
 if (id === "sermon") now.setDate(now.getDate() - now.getDay());
 const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
 const title = id === "sermon" ? `Sermon notes: ${date}` : id === "prayer" ? `Prayer journal: ${date}` : "Verse study";
 const church = options.churchName?.trim();
 const blocks: Block[] = id === "verse-study" ? [
  heading("I begin with God's words"), quote("I copy the full verse here and record its reference (KJV)."),
  heading("I attend to what the verse says"), prompt("I describe what the verse says in its context."),
  heading("I let Scripture explain Scripture"), prompt("I record related passages and what they teach me."),
  heading("I receive what God teaches me"), prompt("I name what I learn about God and what I must change."),
  heading("What I do next"), prompt("I choose one concrete act of obedience today."),
 ] : id === "sermon" ? [
  ...(church ? [prompt(`My church: ${church}`)] : []),
  heading("I begin with the preached passage"), quote("I copy the sermon passage and record its reference (KJV)."),
  heading("I keep the truth the preacher explained"), prompt("I state the sermon's central claim in my own words."),
  heading("I remember what Scripture showed me"), prompt("I record the supporting passages and the truth I need to remember."),
  heading("What I do next"), prompt("I name how I will obey what I heard this week."),
 ] : [
  heading("I thank God for His mercies"), prompt("I name the mercies I have received."),
  heading("I bring my requests to God"), prompt("I state what I ask and entrust the outcome to Him."),
  heading("I pray for these people"), prompt("I name each person and what I ask for them."),
  heading("What I do next"), prompt("I name how I will remain faithful while I wait."),
 ];
 const html = blocks.map(({ kind, text }) => {
  const safe = escapeHtml(text);
  return kind === "heading" ? `<h2>${safe}</h2>` : kind === "quote" ? `<blockquote><p>${safe}</p></blockquote>` : `<p><em>${safe}</em></p>`;
 }).join("");
 const content = JSON.stringify({ type: "doc", content: blocks.map(({ kind, text }) => {
  const leaf = { type: "text", text, ...(kind === "prompt" ? { marks: [{ type: "italic" }] } : {}) };
  const paragraph = { type: "paragraph", content: [leaf] };
  return kind === "heading" ? { type: "heading", attrs: { level: 2 }, content: [leaf] } : kind === "quote" ? { type: "blockquote", content: [paragraph] } : paragraph;
 }) });
 const plainText = blocks.map(block => block.text).join("\n\n");
 return { title, content, html, plainText, wordCount: plainText.trim().split(/\s+/).length };
}
