import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Work bounds; uncertainty never authorizes deleting a literal character. */
export const MARKDOWN_UNDERSCORE_GUARD_LIMITS = { characters: 80_000, nodes: 40_000 } as const;
export interface MarkdownSourceRange { readonly start: number; readonly end: number }
export interface MarkdownUnderscoreAnalysis { readonly length: number; readonly failed: boolean; readonly ranges: readonly MarkdownSourceRange[] }

const containers = new Set(["root", "blockquote", "paragraph", "heading", "list", "listItem", "emphasis", "strong", "delete", "link", "linkReference", "table", "tableRow", "tableCell"]);
const values = new Set(["text", "inlineCode", "code", "html"]);
const nonText = new Set(["break", "thematicBreak", "definition"]);

/** Parse once; presentation must be the trusted no-insertion/order-preserving normalizer. */
export function analyzeMarkdownUnderscores(markdown: string, options: { presentation?: (source: string) => string } = {}): MarkdownUnderscoreAnalysis {
  const length = typeof markdown === "string" ? markdown.length : 0;
  const result = (failed: boolean, ranges: MarkdownSourceRange[] = []): MarkdownUnderscoreAnalysis => Object.freeze({ length, failed, ranges: Object.freeze(ranges.map((range) => Object.freeze(range))) });
  if (typeof markdown !== "string" || length > MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters) return result(true);
  if (!markdown.includes("_")) return result(false);
  if (options.presentation) {
    try {
      const normalized = options.presentation(markdown);
      if (typeof normalized !== "string" || normalized.length > MARKDOWN_UNDERSCORE_GUARD_LIMITS.characters) return result(true);
      const offsets = (source: string) => {
        const found: number[] = [];
        for (let index = source.indexOf("_"); index >= 0; index = source.indexOf("_", index + 1)) found.push(index);
        return found;
      };
      const rawOffsets = offsets(markdown);
      const normalizedOffsets = offsets(normalized);
      // The shared nonstreaming normalizer only deletes underscores; it never
      // inserts or reorders them. Equal counts prove the ordinal bijection.
      if (rawOffsets.length !== normalizedOffsets.length) return result(true);
      const presentation = analyzeMarkdownUnderscores(normalized);
      if (presentation.failed) return result(true);
      return result(false, rawOffsets.flatMap((offset, index) => markdownRangeHasLiteralUnderscore(presentation, normalizedOffsets[index], normalizedOffsets[index] + 1) ? [{ start: offset, end: offset + 1 }] : []));
    } catch {
      return result(true);
    }
  }
  let inspected = false;
  let failed = false;
  const ranges: MarkdownSourceRange[] = [];
  try {
    const inspect = () => (tree: unknown) => {
      inspected = true;
      const pending: unknown[] = [tree];
      const seen = new Set<object>();
      let visited = 0;
      while (pending.length) {
        if (++visited > MARKDOWN_UNDERSCORE_GUARD_LIMITS.nodes || pending.length > MARKDOWN_UNDERSCORE_GUARD_LIMITS.nodes) { failed = true; return; }
        const node = pending.pop();
        if (!node || typeof node !== "object" || seen.has(node)) { failed = true; return; }
        seen.add(node);
        const { type, value, alt, children, position } = node as { type?: unknown; value?: unknown; alt?: unknown; children?: unknown; position?: { start?: { offset?: unknown }; end?: { offset?: unknown } } };
        const start = position?.start?.offset;
        const end = position?.end?.offset;
        if (typeof type !== "string" || typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > length || (end === start && (type !== "root" || length !== 0))) { failed = true; return; }
        if (values.has(type)) {
          if (typeof value !== "string") { failed = true; return; }
          if (value.includes("_")) {
            if (type === "text") {
              // A text node may also contain an unrelated filename before a
              // quote. Map literal raw underscores precisely, not its whole span.
              const raw = markdown.slice(start, end);
              const offsets: number[] = [];
              for (let index = raw.indexOf("_"); index >= 0; index = raw.indexOf("_", index + 1)) offsets.push(start + index);
              if (offsets.length === value.split("_").length - 1) { for (const offset of offsets) ranges.push({ start: offset, end: offset + 1 }); }
              else ranges.push({ start, end }); // Decoded/unmappable source text is conservative.
            } else ranges.push({ start, end }); // Code/raw HTML retain enclosing context.
          }
        } else if (type === "image" || type === "imageReference") {
          if (alt !== null && typeof alt !== "string") { failed = true; return; }
          if (typeof alt === "string" && alt.includes("_")) ranges.push({ start, end });
        } else if (containers.has(type)) {
          if (!Array.isArray(children)) { failed = true; return; }
          for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
        } else if (!nonText.has(type)) { failed = true; return; }
      }
    };
    // Installed Markdown 9.x runs parse/runSync synchronously without hooks.
    // Discard its JSX; no SSR import and no HTML reparse are needed.
    ReactMarkdown({ children: markdown, remarkPlugins: [remarkGfm, inspect] });
    if (!inspected || failed) return result(true);
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: MarkdownSourceRange[] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      else merged.push(range);
    }
    return result(false, merged);
  } catch {
    return result(true);
  }
}

/** Only this quote's original range can make its underscores significant. */
export function markdownRangeHasLiteralUnderscore(analysis: MarkdownUnderscoreAnalysis, start: number, end: number): boolean {
  if (analysis.failed || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > analysis.length) return true;
  let low = 0;
  let high = analysis.ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (analysis.ranges[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  return low < analysis.ranges.length && analysis.ranges[low].start < end;
}

/** Standalone compatibility helper; checker consumers use one full-draft analysis. */
export function hasLiteralMarkdownUnderscore(markdown: string): boolean {
  const analysis = analyzeMarkdownUnderscores(markdown);
  return analysis.failed || analysis.ranges.length > 0;
}
