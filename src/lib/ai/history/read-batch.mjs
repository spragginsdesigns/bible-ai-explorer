/** Two-phase ordinary reads: remote evidence first, then a new owned snapshot. */
import { createSnapshotHistoryReader } from './read-snapshot.mjs';
import { HistoryError } from './service.mjs';
const clone = value => structuredClone(value);
const unavailable = () => { throw new HistoryError('verification_unavailable', 503); };
const textKey = (text, options) => `${options.translation}\0${text}`;
const chapterKey = (edition, order, chapter) => `${edition}:${order}:${chapter}`;

/** Exact request-local canonical work only. No approval/display result is cached. */
export function createCanonicalReadCapture({ verifyCanonical, loadCanonicalChapter }, { maxEntries = 2048, maxCharacters = 8_000_000 } = {}) {
    let open = true, reserved = 0, admitted = 0, lateResults = 0;
    const pending = new Map(), checked = new Map(), chapters = new Map();
    const capture = (kind, key, work) => {
        if (!open) return Promise.reject(new HistoryError('verification_unavailable', 503));
        const identity = `${kind}\0${key}`;
        if (pending.has(identity)) return pending.get(identity).then(clone);
        if (++admitted > maxEntries || (reserved += identity.length) > maxCharacters) return Promise.reject(new HistoryError('context_limit', 413));
        const job = Promise.resolve().then(() => { if (!open) return unavailable(); return work(); }).then(result => {
            const stable = clone(result), size = JSON.stringify(stable).length;
            if (open && reserved + size <= maxCharacters) { reserved += size; (kind === 'text' ? checked : chapters).set(key, stable); }
            else if (!open) lateResults++;
            return stable;
        });
        pending.set(identity, job);
        return job.then(clone);
    };
    const live = Object.freeze({
        verifyCanonical: (text, options) => capture('text', textKey(text, options), () => verifyCanonical(text, options)),
        loadCanonicalChapter: (edition, order, chapter) => capture('chapter', chapterKey(edition, order, chapter), () => loadCanonicalChapter(edition, order, chapter)),
    });
    let frozen;
    return Object.freeze({
        live, isOpen: () => open,
        freeze() {
            if (frozen) return frozen;
            open = false;
            const words = new Map([...chapters].map(([key, value]) => [key, clone(value)]));
            const exact = new Map([...checked].filter(([key, result]) => {
                const edition = key.slice(0, key.indexOf('\0'));
                // A result checked before a changing remote chapter was captured
                // must not lend the later chapter's identity to different words.
                return (result.references ?? []).every(reference => (reference.verses ?? []).every(verse => {
                    const chapter = words.get(chapterKey(edition, verse.order, verse.chapter));
                    return Array.isArray(chapter) && chapter[verse.verse - 1] === verse.text;
                }));
            }).map(([key, value]) => [key, clone(value)]));
            frozen = Object.freeze({
                verifyCanonical: async (text, options) => exact.has(textKey(text, options)) ? clone(exact.get(textKey(text, options))) : unavailable(),
                loadCanonicalChapter: async (edition, order, chapter) => words.has(chapterKey(edition, order, chapter)) ? clone(words.get(chapterKey(edition, order, chapter))) : unavailable(),
            });
            return frozen;
        },
        counts: () => ({ checkedTexts: checked.size, chapters: chapters.size, admitted, lateResults }),
    });
}

async function within(deadlineAt, work) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new HistoryError('verification_timeout', 503);
    let timer;
    try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new HistoryError('verification_timeout', 503)), remaining); })]); }
    finally { clearTimeout(timer); }
}

/** Provisional phase-one results are deliberately discarded, including approvals. */
export async function readHistoryBatch({ ownerId, surface, parentId, loadSnapshot, createService, verifyCanonical, loadCanonicalChapter,
    captureMs = 18_000, requestMs = 27_000, freshReserveMs = 6000 }) {
    const deadlineAt = Date.now() + requestMs;
    const first = await within(deadlineAt, loadSnapshot);
    if (!first) return null;
    const local = createService(first);
    const locators = first.rows.filter(row => row.role === 'assistant').map(row => ({ surface, parentId, messageId: row.id }));
    const external = (await Promise.all(locators.map(async locator => ({ locator, result: await local.get(ownerId, locator) })))).filter(({ locator, result }) => first.requiresLiveRead(locator, result));
    if (!external.length) return { parent: first.parent, rows: first.rows, service: local, externalCapture: null };
    const capture = createCanonicalReadCapture({ verifyCanonical, loadCanonicalChapter });
    const provisional = createService(first, capture.live);
    const pendingResults = new Map(external.map(({ locator, result }) => [locator.messageId, result]));
    const reader = createSnapshotHistoryReader(first, local, {
        get: (owner, locator) => capture.isOpen() ? provisional.get(owner, locator) : Promise.resolve(pendingResults.get(locator.messageId)),
    });
    const budget = Math.max(0, Math.min(captureMs, deadlineAt - Date.now() - freshReserveMs));
    let timer, timedOut = budget <= 0;
    if (budget > 0) {
        const work = Promise.allSettled(external.map(({ locator }) => reader.get(ownerId, locator)));
        try { await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => { timedOut = true; resolve(); }, budget); })]); }
        finally { clearTimeout(timer); }
    }
    const cacheOnly = capture.freeze(); // Late work can neither populate nor alter these maps.
    // Nothing from the initial snapshot is returned after the remote wait.
    const current = await within(deadlineAt, loadSnapshot);
    if (!current) return null;
    return { parent: current.parent, rows: current.rows, service: createService(current, cacheOnly),
        externalCapture: { ...capture.counts(), timedOut } };
}
