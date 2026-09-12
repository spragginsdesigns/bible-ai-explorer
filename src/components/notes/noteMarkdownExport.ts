import TurndownService from "turndown";

const turndown = new TurndownService({
 headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
});
const escapeProse = turndown.escape.bind(turndown);
turndown.escape = text => text.split(/(\[\[[^[\]]+?\]\])/g)
 .map(part => /^\[\[[^[\]]+?\]\]$/.test(part) ? part : escapeProse(part)).join("");
turndown.addRule("taskListItem", {
 filter: node => node.nodeName === "LI" && node.parentNode !== null &&
  (node.parentNode as Element).getAttribute?.("data-type") === "taskList",
 replacement: (content,node) => {
  const item=node as Element;
  const checkbox=Array.from(item.children).flatMap(child => Array.from(child.children))
   .find(child => child.nodeName==="INPUT" && child.getAttribute("type")==="checkbox");
  const declaredState=item.getAttribute("data-checked");
  const checked=declaredState==="true" || (declaredState===null && checkbox?.hasAttribute("checked"));
  return `- [${checked ? "x" : " "}] ${content.trim().replace(/\n/g,"\n    ")}\n`;
 },
});
function escapeRegExp(value:string):string { return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
export function noteHtmlToMarkdown(title:string,html:string):string {
 const noteTitle=title.trim() || "Untitled Note";
 let body=turndown.turndown(html).trim();
 const titleHeading=new RegExp(`^#\\s+${escapeRegExp(noteTitle)}\\s*(?:\\n|$)`,"i");
 body=body.replace(titleHeading,"").trim();
 return `# ${noteTitle}${body ? `\n\n${body}` : ""}\n`;
}
