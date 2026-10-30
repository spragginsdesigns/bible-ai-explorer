/** Pure saved-history extraction and binding; only the owned sidecar grants approval. */
import { createHash } from 'node:crypto';
import { EVIDENCE, MEMORY_OPAQUE_FIELDS, OUTPUT_OPAQUE_FIELDS, INERT_READ_OUTPUT_FIELDS, RECEIPT_ONLY_FAILURE_TOOLS, TOOL_EVIDENCE } from './classification.mjs';

export const CORE_VERSION = 'history-display-v3';
export const LIMITS = Object.freeze({ bytes: 500_000, depth: 24, nodes: 15_000, parts: 96, text: 80_000, items: 80 });
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
class Blocked extends Error { constructor(code, path) { super(code); this.code = code; this.path = path; } }
const fail = (code, path) => { throw new Blocked(code, path); };

/** JSON semantics only: no getters, cycles, sparse arrays, nonfinite numbers or lossy coercion. */
export function canonicalJSON(value) {
  let nodes = 0;
  const seen = new Set();
  function walk(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('json_bounds', '$');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') {
      if (v.length > LIMITS.text) fail('text_bounds', '$');
      // Reject lone UTF-16 surrogates, avoiding cross-language digest disagreement.
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) { const n = v.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('invalid_unicode', '$'); }
        else if (c >= 0xdc00 && c <= 0xdfff) fail('invalid_unicode', '$');
      }
      return JSON.stringify(v);
    }
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) fail('invalid_number', '$'); return JSON.stringify(v); }
    if (!(Array.isArray(v) || record(v)) || seen.has(v)) fail('non_json', '$');
    seen.add(v);
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) if (d.get || d.set || (!d.enumerable && !(Array.isArray(v) && key === 'length'))) fail('non_json', '$');
    if (Object.getOwnPropertySymbols(v).length) fail('non_json', '$');
    let result;
    if (Array.isArray(v)) {
      if (v.length > LIMITS.nodes || Object.keys(v).length !== v.length || Object.keys(v).some((key, index) => key !== String(index))) fail('non_json', '$');
      result = '[' + v.map(x => walk(x, depth + 1)).join(',') + ']';
    } else {
      result = '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + walk(v[k], depth + 1)).join(',') + '}';
    }
    seen.delete(v);
    return result;
  }
  const json = walk(value, 0);
  if (Buffer.byteLength(json, 'utf8') > LIMITS.bytes) fail('json_bounds', '$');
  return json;
}
export const digest = value => createHash('sha256').update(canonicalJSON(value), 'utf8').digest('hex');
const clone = value => JSON.parse(canonicalJSON(value));
/** Only the assistant/source envelope is verification authority. Ratings and
 * ORM bookkeeping stay user-owned and never trigger paid re-verification. */
export const historyAISourceRow = row => ({id:row.id,role:row.role,content:row.content,metadata:row.metadata??null,...(row.createdAt?{createdAt:row.createdAt}:{})});
const string = (max = 2400) => (v, p) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('invalid_string', p); return v; };
const text = (v, p) => { if (typeof v !== 'string' || v.length > LIMITS.text) fail('invalid_text', p); return v; };
const bool = (v, p) => { if (typeof v !== 'boolean') fail('invalid_boolean', p); return v; };
const number = (v, p) => { if (!Number.isFinite(v)) fail('invalid_number', p); return v; };
const natural = (v, p) => { if (!Number.isSafeInteger(v) || v < 0) fail('invalid_integer', p); return v; };
const positive = (v, p) => { natural(v, p); if (!v) fail('invalid_integer', p); return v; };
const one = values => (v, p) => { if (!values.includes(v)) fail('invalid_enum', p); return v; };
const optional = check => Object.assign((v, p) => check(v, p), { optional: true });
const nullable = check => (v, p) => v === null ? null : check(v, p);
const array = (check, max = LIMITS.items) => (v, p) => { if (!Array.isArray(v) || v.length > max) fail('invalid_array', p); return v.map((x, i) => check(x, `${p}[${i}]`)); };
const object = shape => (v, p) => {
  if (!record(v)) fail('invalid_object', p);
  for (const k of Object.keys(v)) if (!own(shape, k)) fail('unknown_field', p);
  const out = {};
  for (const [k, check] of Object.entries(shape)) {
    if (!own(v, k)) { if (!check.optional) fail('missing_field', `${p}.${k}`); }
    else out[k] = check(v[k], `${p}.${k}`);
  }
  return out;
};
const url = (v, p) => { string(2048)(v, p); let u; try { u = new URL(v); } catch { fail('invalid_url', p); } if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('invalid_url', p); return v; };
const translation = one(['KJV', 'NKJV', 'BSB', 'ASV', 'RV1909', 'LUT1912']);
const id = string(160);
const verses = array(object({ reference: string(180), similarity: number, text: optional(text), translation: optional(translation) }));
const results = array(object({ title: string(1000), content: text, url, favicon: optional(url) }));
const step = one(['textScale', 'name', 'faith', 'walk', 'testimony', 'church', 'prayer', 'dailyTime', 'tour', 'aboutMe', 'other']);
const target = one(['tab.today', 'tab.bible', 'tab.chat', 'tab.study', 'tab.connections', 'today.cross', 'today.learn', 'today.plan', 'reader.verse', 'study.sermons', 'study.notes', 'settings.church', 'settings.textSize', 'chat.mic', 'tour']);
const progressSource = object({ title: string(100), url });
const progressEntry = object({ id: string(120), kind: one(['tool', 'summary', 'status']), state: one(['running', 'complete', 'error', 'interrupted']), label: string(180), detail: optional(string(2400)), sources: optional(array(progressSource, 6)) });
const progress = object({ version: one([1]), runId: id, sequence: natural, elapsedMs: natural, lastActivityMs: natural, state: one(['complete', 'error']), phase: one(['preparing', 'thinking', 'tool', 'answering']), label: string(180), entries: array(progressEntry, 48) });
const opaque = value => value; // Already canonical-JSON/bounds checked before extraction.
// SDK ProviderMetadata is a provider namespace -> JSON object map. Its values
// remain in the bounded raw source digest/archive; no client reducer reads them.
const providerMetadata = (value, path) => {
  if (!record(value) || Object.values(value).some(namespace => !record(namespace))) fail('invalid_provider_metadata', path);
  return value;
};
const textTransport = { providerMetadata: optional(providerMetadata) };
const toolTransport = { providerExecuted: optional(bool), callProviderMetadata: optional(providerMetadata), resultProviderMetadata: optional(providerMetadata) };
// A provider execution hint never proves an action. Preliminary output is not
// a settled answer, even though the SDK labels its state output-available.
const settledToolTransport = { ...toolTransport, preliminary: optional(one([false])) };
const memory = object({ id, ...Object.fromEntries(MEMORY_OPAQUE_FIELDS.map(field => [field, optional(opaque)])) });
const schemas = {
  searchScripture: { output: { verses } }, findVerses: { output: { verses } }, searchOriginalLanguage: { output: { verses } }, getPassage: { output: { verses } },
  webSearch: { output: { results } },
  presentChoices: { output: { step, question: string(), options: array(string(), 12), allowOther: bool, skipLabel: string(), terms: array(one(['saved']), 1) } },
  showInApp: { output: { target, caption: string(), stops: optional(array(object({ target, caption: string() }), 15)) } },
  addToNote: { action: true, output: { noteId: id, noteTitle: string(), created: bool, matchedExisting: optional(bool), appendedHtml: optional(text) }, omit: ['appendedHtml'] },
  updateNote: { action: true, output: { noteId: id, noteTitle: string(), appendedHtml: optional(text) }, omit: ['appendedHtml'] },
  organizeNote: { action: true, output: { success: optional(one([true])), noteId: id, title: string() } },
  saveMemory: { action: true, output: { success: one([true]), memory } },
  updateMemory: { action: true, output: { success: one([true]), memory } },
  resolvePrayerRequest: { action: true, output: { success: one([true]), memory, outcome: one(['answered', 'closed']) } },
  deleteMemories: { action: true, output: { success: one([true]), deleted: positive } },
  setDailyCross: { action: true, output: { reference: string(180), text, reason: string(), previousReference: nullable(string(180)) } },
  logReading: { action: true, output: { success: one([true]), reference: string(180), localDate: string(30), book: positive, chapter: positive } },
  correctReadingLog: { action: true, output: { success: one([true]), eventId: id } },
  removeReadingLog: { action: true, output: { success: one([true]), eventId: id, removed: bool } },
  startReadingPlan: { action: true, output: { hasPlan: one([true]), title: string() } },
  markReadingPlanDay: { action: true, input: { day: positive, done: optional(bool) }, output: { hasPlan: one([true]) } },
  highlightVerse: { action: true, output: { success: one([true]), reference: string(180), bookNumber: positive, chapter: positive, verse: positive, colorName: optional(string()), translation: optional(translation) } },
  learnVerse: { action: true, output: { success: one([true]), reference: string(180) } },
};
for (const [name, fields] of Object.entries(OUTPUT_OPAQUE_FIELDS)) for (const field of fields) schemas[name].output[field] = optional(opaque);
export const SUPPORTED_TOOLS = Object.freeze(Object.keys(schemas));
export const KNOWN_INERT_READ_TOOLS = Object.freeze(Object.keys(INERT_READ_OUTPUT_FIELDS));
export const FIXED_NOTICES = Object.freeze({
  unavailableEnglish: "I couldn't finish checking this answer against Scripture, so I've withheld it. Please try again.",
  unavailableSpanish: 'No pude terminar de comprobar esta respuesta con las Escrituras, así que no la he mostrado. Por favor, inténtalo de nuevo.',
  unavailableGerman: 'Ich konnte diese Antwort nicht vollständig anhand der Schrift prüfen und habe sie deshalb zurückgehalten. Bitte versuche es erneut.',
  providerIncomplete: 'The model provider stopped this answer before completion. The response above is incomplete. Please ask for a shorter explanation or read the passage in the Bible reader.',
  timeIncomplete: 'I reached the time limit before completing your request. Any successful tool results are retained, but I have not finished the requested answer or verified the whole result. You can ask me to continue from this point.',
});
const knownMetadata = new Set(['parts', 'followUps', 'retrievedVerses', 'tavilyResults', 'averageSimilarity', 'translation', 'modelId', 'runOptions', 'speed', 'verbosity', 'mode', 'turnShape', 'source']);
const words = value => value.normalize('NFC').match(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu) ?? [];

/**
 * renderer is a server-imported pinned adapter with normalize/strip, never request JSON.
 * policy binds its source hash and the canonical corpus/foundation/reviewer contract.
 * Result is a review CANDIDATE; callers MUST NOT expose it before DB-side review passes.
 */
export function projectHistory({ source, context, policy }, renderer) {
  try {
    const sourceDigest = digest(source), contextDigest = digest(context), policyDigest = digest(policy);
    object({ contractVersion: one([1]), projectorVersion: one([CORE_VERSION]), rendererDigest: string(64), checkerVersion: id, corpusDigest: string(64), foundationDigest: string(64), fixedNoticesVersion: one([1]) })(policy, 'policy');
    if (!renderer || renderer.digest !== policy.rendererDigest || typeof renderer.normalize !== 'function' || typeof renderer.strip !== 'function' || typeof renderer.receipts !== 'function' || typeof renderer.progress !== 'function') fail('renderer_mismatch', 'policy.rendererDigest');
    object({ surface: one(['chat', 'note']), parentId: id, ownerId: id, row: object({ id, role: one(['assistant', 'user']), content: text, metadata: nullable((v, p) => { if (!record(v)) fail('invalid_object', p); return v; }), createdAt: optional(string(60)), feedback: optional(nullable(one(['up', 'down']))) }) })(source, 'source');
    const row = source.row, metadata = row.metadata ?? {};
    for (const k of Object.keys(metadata)) if (!knownMetadata.has(k)) fail('unknown_metadata', 'metadata');
    if (own(metadata, 'translation')) translation(metadata.translation, 'metadata.translation');
    object({ translation, translationEvidence: one(['persisted', 'explicit-owner-review']), question: text, history: array((v, p) => { if (!record(v)) fail('invalid_object', p); return v; }, 80), evidence: array((v, p) => { if (!record(v)) fail('invalid_object', p); return v; }, 80) })(context, 'context');
    if (metadata.translation && metadata.translation !== context.translation) fail('translation_mismatch', 'metadata.translation');
    if (row.role === 'assistant' && context.translationEvidence === 'persisted' && metadata.translation !== context.translation) fail('unknown_translation', 'metadata.translation');
    const blocks = [], canonicalSources = [], actions = [], projectionOmissions = [], toolDispositions = [], canonicalPaths = new Set();
    const omission = (path, classification, evidenceId) => projectionOmissions.push({ path, classification, evidenceId });
    const withoutTransport = (shape, transport, value, path) => {
      const out = object({ ...shape, ...transport })(value, path);
      for (const field of Object.keys(transport)) if (own(out, field)) {
        delete out[field];
        omission(`${path}.${field}`, 'known nonrendered SDK transport field; never Scripture or action approval evidence', 'sdkTransport');
      }
      return out;
    };
    const disposition = (path, part, classification, evidenceId) => toolDispositions.push({ path, type: part.type, state: part.state ?? null, toolCallId: part.toolCallId ?? null, classification, evidenceId });
    const addBlock = (path, value, kind = 'generated') => { blocks.push({ path, kind, text: value }); };
    function visible(value, path) {
      // Exact card Scripture fields have their own full canonical preflight;
      // keep every word in canonicalSources rather than duplicating a whole
      // chapter into separate semantic blocks for its reference/text labels.
      if (canonicalPaths.has(path)) return;
      if (typeof value === 'string') addBlock(path, value);
      else if (Array.isArray(value)) value.forEach((v, i) => visible(v, `${path}[${i}]`));
      else if (record(value)) for (const [k, v] of Object.entries(value)) visible(v, `${path}.${k}`);
    }
    function recordVerses(value, path, kind) {
      value.forEach((v, i) => {
        if (!own(v, 'text')) fail('missing_canonical_text', `${path}[${i}].text`);
        canonicalSources.push({ path: `${path}[${i}]`, reference: v.reference, text: v.text, translation: v.translation ?? context.translation, sourceKind: kind });
        for (const field of ['reference','text','translation']) canonicalPaths.add(`${path}[${i}].${field}`);
      });
    }
    let parts;
    if (own(metadata, 'parts')) {
      if (!Array.isArray(metadata.parts) || !metadata.parts.length || metadata.parts.length > LIMITS.parts) fail('invalid_parts', 'metadata.parts');
      parts = metadata.parts.map((part, i) => {
        const p = `metadata.parts[${i}]`;
        if (!record(part) || typeof part.type !== 'string') fail('invalid_part', p);
        if (part.type === 'text') return withoutTransport({ type: one(['text']), text, id: optional(id), state: optional(one(['done'])) }, textTransport, part, p);
        if (row.role === 'user') fail('user_nontext_part', p);
        if (part.type === 'step-start') {
          object({ type: one(['step-start']) })(part, p);
          omission(p, 'known SDK step boundary has no settled text, card, receipt or effect', 'sdkTransport');
          return null;
        }
        if (part.type === 'data-memoryExtracted') fail('passive_memory_history_mismatch', p);
        if (part.type === 'data-status') {
          object({ type: one(['data-status']), id: optional(id), data: object({ label: text }) })(part, p);
          omission(p, 'known transient status is not rendered on settled history restore', 'historyStatus');
          return null;
        }
        if (part.type === 'data-progress') {
          const out = object({ type: one(['data-progress']), id: optional(id), data: progress })(part, p);
          visible(out.data, p + '.data'); return out;
        }
        if (!part.type.startsWith('tool-')) fail('unsupported_part', p);
        const name = part.type.slice(5), schema = schemas[name];
        if (!schema && !own(INERT_READ_OUTPUT_FIELDS, name)) fail('unsupported_part', p);
        if (['output-error', 'input-available', 'input-streaming'].includes(part.state)) {
          withoutTransport({ type: one([part.type]), toolCallId: optional(id), state: one(['output-error', 'input-available', 'input-streaming']), input: optional(opaque), rawInput: optional(opaque), output: optional(opaque), errorText: optional(text) }, toolTransport, part, p);
          const classification = part.state === 'output-error' ? 'known failed tool has no settled card/receipt' : 'known unfinished tool has no settled card/receipt; outcome unconfirmed';
          omission(p, classification, 'settledState'); disposition(p, part, classification, 'settledState'); return null;
        }
        if (part.state !== 'output-available') fail('unknown_tool_state', p);
        if (RECEIPT_ONLY_FAILURE_TOOLS.includes(name) && part.output?.success === false) {
          withoutTransport({ type: one([part.type]), toolCallId: optional(id), state: one(['output-available']), input: optional(opaque), output: object({ success: one([false]), error: text }) }, settledToolTransport, part, p);
          const classification = 'known success:false tool has no card or receipt; no successful action inferred';
          omission(p, classification, 'receipts'); disposition(p, part, classification, 'receipts'); return null;
        }
        if (!schema) {
          withoutTransport({ type: one([part.type]), toolCallId: id, state: one(['output-available']), input: optional(opaque), output: object(Object.fromEntries(INERT_READ_OUTPUT_FIELDS[name].map(field => [field, optional(opaque)]))) }, settledToolTransport, part, p);
          omission(p, 'known read tool has no settled card or receipt; not fresh Scripture/action evidence', 'noReadCard');
          disposition(p, part, 'known inert read output', 'noReadCard'); return null;
        }
        const out = withoutTransport({ type: one([part.type]), toolCallId: id, state: one(['output-available']), input: optional((v, path) => { if (!record(v)) fail('invalid_object', path); return v; }), output: object(schema.output) }, settledToolTransport, part, p);
        // All raw inputs stay in sourceDigest; only the one receipt-dependent input is displayed.
        if (!schema.input && out.input && Object.keys(out.input).length) omission(p + '.input', 'known inputs not read by settled cards or receipts for this tool', 'receipts');
        out.input = schema.input ? object(schema.input)(out.input, p + '.input') : {};
        if (schema.action) actions.push({ path: p, tool: name, toolCallId: out.toolCallId, requirement: 'owned durable successful-operation evidence; stored output alone is insufficient' });
        if (out.output.verses) recordVerses(out.output.verses, p + '.output.verses', name);
        if (name === 'setDailyCross') canonicalSources.push({ path: p + '.output', reference: out.output.reference, text: out.output.text, translation: context.translation, sourceKind: name });
        for (const field of [...(schema.omit ?? []), ...(OUTPUT_OPAQUE_FIELDS[name] ?? [])]) {
          if (own(out.output, field)) {
            delete out.output[field];
            omission(`${p}.output.${field}`, field === 'appendedHtml' ? 'known effect-only HTML; never replay' : 'known output field ignored by all audited reducers', field === 'appendedHtml' ? 'noAppend' : TOOL_EVIDENCE[name]);
          }
        }
        if (['saveMemory', 'updateMemory', 'resolvePrayerRequest'].includes(name)) for (const field of MEMORY_OPAQUE_FIELDS) {
          if (own(out.output.memory, field)) { delete out.output.memory[field]; omission(`${p}.output.memory.${field}`, 'known memory field ignored by all audited receipt reducers', 'memory'); }
        }
        visible(out.output, p + '.output'); visible(out.input, p + '.input');
        return out;
      }).filter(part => part !== null);
    } else parts = [{ type: 'text', text: row.content }];
    const textParts = parts.filter(p => p.type === 'text');
    const joined = textParts.map(p => p.text).filter(t => t.trim() !== '').join('\n\n');
    // Existing web/Android join differs from Apple concatenation: one canonical text part removes this ambiguity.
    const body = row.role === 'user' ? joined : renderer.strip(joined);
    if (body !== row.content) fail('content_parts_disagree', 'row.content');
    const inlineFollowUps = [];
    if (row.role === 'assistant') {
      const seen = new Set();
      for (const match of joined.matchAll(/^[ \t]*\[FOLLOWUP\][ \t]*([^\r\n]+)/gm)) {
        const question = match[1].trim(), key = question.toLowerCase();
        if (question && !seen.has(key)) { seen.add(key); inlineFollowUps.push(question); }
      }
      if (inlineFollowUps.length > 2) fail('followup_bounds', 'metadata.parts');
      // Markers surviving the actual fenced-code-aware stripper would be both body and chip.
      if (/\[FOLLOWUP\]/i.test(body)) fail('ambiguous_followup_marker', 'metadata.parts');
    }
    const normalizedBody = row.role === 'user' ? body : renderer.normalize(body);
    if (JSON.stringify(words(body)) !== JSON.stringify(words(normalizedBody))) fail('body_word_parity', 'row.content');
    if (row.role === 'user' && parts.some(p => p.type !== 'text')) fail('user_nontext_part', 'metadata.parts');
    const fixedNotices = textParts.flatMap((part, index) => {
      const match = Object.entries(FIXED_NOTICES).find(([, value]) => value === part.text);
      return match ? [{ path: `textParts[${index}]`, id: match[0], text: part.text, provenance: 'known literal only; not proof of original verification' }] : [];
    });
    const fixed = Object.entries(FIXED_NOTICES).find(([, value]) => value === body);
    addBlock('body', normalizedBody, row.role === 'user' ? 'user-authored' : fixed ? 'fixed-notice' : 'generated');
    const sanitized = {};
    const storedFollowUps = own(metadata, 'followUps') ? array(string(), 2)(metadata.followUps, 'metadata.followUps') : [];
    const mergedFollowUps = [...new Set([...inlineFollowUps, ...storedFollowUps])];
    if (mergedFollowUps.length > 2) fail('followup_bounds', 'metadata.followUps');
    if (mergedFollowUps.length) { sanitized.followUps = mergedFollowUps; visible(sanitized.followUps, 'metadata.followUps'); }
    if (own(metadata, 'retrievedVerses')) { sanitized.retrievedVerses = verses(metadata.retrievedVerses, 'metadata.retrievedVerses'); recordVerses(sanitized.retrievedVerses, 'metadata.retrievedVerses', 'legacy'); visible(sanitized.retrievedVerses, 'metadata.retrievedVerses'); }
    if (own(metadata, 'tavilyResults')) { sanitized.tavilyResults = results(metadata.tavilyResults, 'metadata.tavilyResults'); visible(sanitized.tavilyResults, 'metadata.tavilyResults'); }
    if (own(metadata, 'averageSimilarity')) sanitized.averageSimilarity = number(metadata.averageSimilarity, 'metadata.averageSimilarity');
    if (row.role === 'user' && Object.keys(sanitized).length) fail('user_assistant_metadata', 'metadata');
    // Collapse text only at its first position; keep all nontext relative order. Review covers exact resulting display.
    let bodyAdded = false;
    sanitized.parts = parts.flatMap(p => {
      if (p.type !== 'text') return [p];
      if (bodyAdded) return [];
      bodyAdded = true; return [{ type: 'text', text: normalizedBody }];
    });
    if (!bodyAdded && normalizedBody) fail('missing_body', 'metadata.parts');
    if (row.role === 'assistant') sanitized.translation = context.translation;
    const display = { id: row.id, role: row.role, content: normalizedBody, metadata: sanitized, ...(row.createdAt ? { createdAt: row.createdAt } : {}), ...(own(row, 'feedback') ? { feedback: row.feedback } : {}) };
    if (!normalizedBody.trim() && parts.every(p => ['text', 'data-progress'].includes(p.type))) fail('empty_answer', 'row.content');
    const noticeOnly = textParts.length > 0 && textParts.every(p => !p.text.trim() || Object.values(FIXED_NOTICES).includes(p.text)) && parts.every(p => ['text', 'data-progress'].includes(p.type));
    const renderedReceipts = renderer.receipts(sanitized.parts);
    renderedReceipts.forEach((receipt, index) => addBlock(`receipts[${index}].label`, receipt.label, 'receipt'));
    const renderedProgress = renderer.progress(sanitized.parts) ?? null;
    const review = { blocks, canonicalSources, actions, projectionOmissions, toolDispositions, classificationEvidence: Object.fromEntries([...new Set([...projectionOmissions, ...toolDispositions].map(item => item.evidenceId))].map(key => [key, EVIDENCE[key]])), fixedNotices, renderedReceipts, renderedProgress, fixedNoticeId: fixed?.[0] ?? null, requiresSemanticReview: row.role === 'assistant' && !noticeOnly, requiresActionProof: actions.length > 0 };
    if (blocks.length > 32 || blocks.reduce((n, b) => n + b.text.length, 0) > LIMITS.text) fail('review_bounds', 'review.blocks');
    const displayDigest = digest(display), reviewDigest = digest(review);
    const binding = { sourceDigest, contextDigest, policyDigest, displayDigest, reviewDigest };
    return clone({ ok: true, kind: row.role === 'user' ? 'user-authored' : noticeOnly ? 'fixed-notice-only' : 'assistant-review-candidate', binding: { ...binding, envelopeDigest: digest(binding) }, display, review });
  } catch (e) {
    if (e instanceof Blocked) return { ok: false, code: e.code, path: e.path };
    throw e;
  }
}

/** Mechanical comparison ONLY. stored must come from the future owner-scoped DB sidecar, never a request. */
export function matchesStoredReview(candidate, stored) {
  if (!candidate?.ok || candidate.kind !== 'assistant-review-candidate' || candidate.display?.role !== 'assistant' || candidate.review?.requiresSemanticReview !== true || !record(candidate.binding) || !record(stored) || stored.status !== 'verified') return false;
  try {
    if (digest(candidate.display) !== candidate.binding.displayDigest || digest(candidate.review) !== candidate.binding.reviewDigest) return false;
    const { envelopeDigest, ...binding } = candidate.binding;
    if (digest(binding) !== envelopeDigest) return false;
  } catch { return false; }
  const keys = ['sourceDigest', 'contextDigest', 'policyDigest', 'displayDigest', 'reviewDigest', 'envelopeDigest'];
  return keys.every(k => typeof stored[k] === 'string' && stored[k] === candidate.binding[k]) && stored.semanticPassed === true && stored.canonicalPassed === true && (!candidate.review.requiresActionProof || stored.actionProofPassed === true);
}
