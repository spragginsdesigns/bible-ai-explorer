/** Export the live TenTap/Tiptap document without relying on a native DOM. */
interface Node { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] }
function prose(text: string): string {
 return text.split(/(\[\[[^[\]]+?\]\])/g).map(part => {
  if (/^\[\[[^[\]]+?\]\]$/.test(part)) return part;
  return part.replace(/([\\`*_[\]<>])/g, "\\$1")
   .replace(/^(\s*)([-+=#~])/gm, "$1\\$2")
   .replace(/^(\s*\d+)([.)])(?=\s)/gm, "$1\\$2");
 }).join("");
}
function inline(node: Node): string {
 if (node.type === "hardBreak") return "  \n";
 if (node.type !== "text" || typeof node.text !== "string") throw new Error("This note contains content that cannot be exported yet.");
 const code = node.marks?.some(mark => mark.type === "code");
 let text = code ? node.text : prose(node.text);
 for (const mark of node.marks ?? []) {
  switch (mark.type) {
   case "bold": text = `**${text}**`; break;
   case "italic": text = `*${text}*`; break;
   case "strike": text = `~~${text}~~`; break;
   case "underline": text = `<u>${text}</u>`; break;
   case "highlight": text = `==${text}==`; break;
   case "code": { const fence = "`".repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1))); text = `${fence} ${text} ${fence}`; break; }
   case "link": {
    const href = String(mark.attrs?.href ?? "").replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
    text = `[${text}](${href})`; break;
   }
   default: throw new Error("This note contains formatting that cannot be exported yet.");
  }
 }
 return text;
}
function block(node: Node): string {
 const children = node.content ?? [];
 switch (node.type) {
  case "doc": return children.map(block).join("\n\n");
  case "paragraph": return children.map(inline).join("");
  case "heading": return "#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))) + " " + children.map(inline).join("");
  case "blockquote": return children.map(block).join("\n\n").split("\n").map(line => "> " + line).join("\n");
  case "bulletList": case "orderedList": case "taskList": return children.map((item, index) => {
   if (!["listItem", "taskItem"].includes(item.type)) throw new Error("Invalid list item.");
   const marker = node.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : node.type === "orderedList" ? `${Number(node.attrs?.start ?? 1) + index}. ` : "- ";
   return marker + (item.content ?? []).map(block).join("\n\n").replace(/\n/g, "\n    ");
  }).join("\n");
  case "codeBlock": {
   const text = children.map(child => child.text ?? "").join("");
   const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
   return `${fence}${String(node.attrs?.language ?? "").replace(/[^a-zA-Z0-9_+-]/g, "")}\n${text}\n${fence}`;
  }
  case "horizontalRule": return "---";
  default: throw new Error("This note contains content that cannot be exported yet.");
 }
}
export function noteDocumentToMarkdown(title: string, value: unknown): string {
 if (!value || typeof value !== "object" || (value as Node).type !== "doc" || !Array.isArray((value as Node).content)) throw new Error("The editor is not ready. Please try again.");
 const noteTitle = title.trim() || "Untitled Note";
 const doc = value as Node;
 const first = doc.content?.[0];
 const duplicateTitle = first?.type === "heading" && first.attrs?.level === 1 && (first.content ?? []).map(child => child.text ?? "").join("").trim().toLowerCase() === noteTitle.toLowerCase();
 const body = block({ ...doc, content: duplicateTitle ? doc.content?.slice(1) : doc.content }).trim();
 return `# ${noteTitle}${body ? `\n\n${body}` : ""}\n`;
}
