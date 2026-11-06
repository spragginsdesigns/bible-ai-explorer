/** Provider-free, request-local ordinary reads. No snapshot escapes into a shared cache. */
import { HistoryError } from './service.mjs';
import { digest, historyAISourceRow } from './projection.mjs';
import { preparedReviewRecord } from './prepared-request.mjs';
import { recoveredFreshActions } from './fresh-proof.mjs';
const clone = value => structuredClone(value);
const json = value => JSON.parse(JSON.stringify(value));
const bindingKeys = ['sourceDigest', 'contextDigest', 'policyDigest', 'displayDigest', 'reviewDigest', 'envelopeDigest'];
const sourceDigest = source => { try { return digest(source); } catch { return null; } };

/** Mirror only get()'s repository reads; mutation methods and other owners fail closed. */
export function createHistoryReadSnapshot(input, { hasCurrentAiConsent }) {
    const data = clone(input), { ownerId, surface, parentId } = data;
    if (!['chat', 'note'].includes(surface) || data.user?.id !== ownerId || data.parent?.id !== parentId || data.parent.userId !== ownerId)
        throw new HistoryError('not_found', 404);
    const parentColumn = surface === 'chat' ? 'conversationId' : 'noteId';
    // Preserve database ordering (createdAt,id), including collation; do not re-sort IDs in JS.
    const rows = data.rows.filter(row => row[parentColumn] === parentId).map(json);
    const byId = new Map(rows.map(row => [row.id, row]));
    const attachments = data.attachments.filter(row => byId.has(row.messageId));
    const sourceFor = row => ({ surface, parentId, ownerId, row: historyAISourceRow(row) });
    const sourceDigests = new Map(rows.filter(row => row.role === 'assistant').map(row => [row.id, sourceDigest(sourceFor(row))]));
    const reviews = data.reviews.filter(record => record.ownerId === ownerId &&
        (surface === 'chat' ? record.mainMessageId && record.noteAiMessageId === null : record.noteAiMessageId && record.mainMessageId === null) &&
        sourceDigests.get(surface === 'chat' ? record.mainMessageId : record.noteAiMessageId) === record.sourceDigest);
    const actionOrder = new Map((data.actionReviewIds ?? []).map((id, index) => [id, index]));
    const owned = locator => locator?.surface === surface && locator.parentId === parentId ? byId.get(locator.messageId) ?? null : null;
    const targetReviews = (locator, states) => reviews.filter(record =>
        (surface === 'chat' ? record.mainMessageId : record.noteAiMessageId) === locator.messageId && (!states || states.includes(record.state)));
    const denied = async () => { throw new HistoryError('verification_unavailable', 503); };
    const readMethods = {
        currentTime: async () => new Date(data.currentTime),
        hasConsent: async () => hasCurrentAiConsent(clone(data.user)),
        readPolicySnapshot: async () => clone({ user: data.user, subscription: data.subscription }),
        loadOwnedTarget: async locator => clone(owned(locator)),
        loadPreparedDependencies: async (locator, ids, attachmentIds) => {
            if (locator?.surface !== surface || locator.parentId !== parentId) return { rows: [], attachments: [] };
            return { rows: clone(rows.filter(row => ids.includes(row.id))), attachments: clone(surface === 'chat' ? attachments.filter(row => row.userId === ownerId && ids.includes(row.messageId) && attachmentIds.includes(row.id)) : []) };
        },
        loadPreparedReview: async locator => {
            const target = owned(locator); if (!target) return null;
            // A newer explicit legacy recheck retires an older prepared certificate.
            const latest = targetReviews(locator, ['verified'])[0];
            return latest ? preparedReviewRecord(latest, sourceFor(target)) : null;
        },
        loadOwnedBundle: async (locator, maxRows) => {
            const target = owned(locator); if (!target) return null;
            const prefix = rows.filter(row => row.createdAt <= target.createdAt).slice(0, maxRows + 1);
            return clone({ target, prefix, complete: prefix.length <= maxRows,
                attachmentsPresent: surface === 'chat' && attachments.some(row => prefix.some(source => source.id === row.messageId)) });
        },
        loadDurableActionProof: async (locator, actions) => {
            const target = owned(locator); if (!target) return { complete: false, manifest: [] };
            for (const record of targetReviews(locator, ['verified', 'notice']).filter(record => actionOrder.has(record.id)).sort((a, b) => actionOrder.get(a.id) - actionOrder.get(b.id)).slice(0, 20)) {
                const manifest = recoveredFreshActions(record, sourceFor(target), actions);
                if (manifest) return clone({ complete: true, manifest });
            }
            return { complete: false, manifest: [] };
        },
        findBinding: async binding => clone(reviews.find(record => bindingKeys.every(key => record[key] === binding[key])) ?? null),
        // get() looks for the newest settled review of the exact current source; every
        // loaded review already matches a current source digest.
        targetVersions: async (locator, reviewId, take) => reviewId || owned(locator) === null ? [] : clone(targetReviews(locator).slice(0, take)),
    };
    const tx = new Proxy(Object.freeze(readMethods), { get(target, key) { return Object.hasOwn(target, key) ? target[key] : key === 'then' || typeof key !== 'string' ? undefined : denied; } });
    return Object.freeze({
        parent: clone(data.parent),
        rows: rows.map(row => ({ ...clone(row), ...(surface === 'chat' ? { attachments: clone(attachments.filter(file => file.messageId === row.id && file.userId === ownerId)) } : {}) })),
        repository: Object.freeze({ async withOwnerLock(owner, work) { if (owner !== ownerId) throw new HistoryError('not_found', 404); return work(tx); } }),
        requiresLiveRead: (locator, localResult) => {
            const target = owned(locator), approved = targetReviews(locator, ['verified', 'notice']);
            if (!target || !approved.length) return false; // Unapproved prose cannot be released; no remote words are needed to withhold it.
            const external = target.metadata?.translation === 'NKJV' || approved.some(record => record.freshEvidence?.external != null);
            if (!external || !localResult) return external;
            if (localResult.status === 200 && ['verified', 'notice'].includes(localResult.body?.state)) return false;
            const code = localResult.body?.row?.metadata?.historyVerification?.code ?? localResult.body?.code;
            return code === 'verification_unavailable'; // Other local refusal reasons already preclude release.
        },
    });
}

/** One short MVCC snapshot, no row locks, inference, external fetches or writes. */
export async function loadHistoryReadSnapshot(prisma, ownerId, { surface, parentId }, dependencies) {
    if (!['chat', 'note'].includes(surface) || typeof ownerId !== 'string' || typeof parentId !== 'string') throw new HistoryError('not_found', 404);
    return prisma.$transaction(async db => {
        await db.$executeRaw`SET TRANSACTION READ ONLY`;
        const [user, parent] = await Promise.all([
            db.user.findUnique({ where: { id: ownerId }, select: { id: true, plan: true, aiConsentVersion: true, aiConsentAt: true } }),
            (surface === 'chat' ? db.conversation : db.note).findFirst({ where: { id: parentId, userId: ownerId } }),
        ]);
        if (!user || !parent) return null;
        const where = surface === 'chat' ? { conversationId: parentId, conversation: { userId: ownerId } } : { noteId: parentId, note: { userId: ownerId } };
        const [rows, attachments, subscription, time] = await Promise.all([
            (surface === 'chat' ? db.message : db.noteAIMessage).findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
            surface === 'chat' ? db.chatAttachment.findMany({ where: { message: { conversationId: parentId, conversation: { userId: ownerId } } } }) : [],
            dependencies.readSubscription(ownerId, db),
            db.$queryRaw`SELECT clock_timestamp() AS "currentTime"`,
        ]);
        const assistant = rows.filter(row => row.role === 'assistant');
        const reviewWhere = { ownerId,
            ...(surface === 'chat' ? { mainMessageId: { in: assistant.map(row => row.id) }, noteAiMessageId: null } : { noteAiMessageId: { in: assistant.map(row => row.id) }, mainMessageId: null }),
            sourceDigest: { in: assistant.map(row => sourceDigest({ surface, parentId, ownerId, row: historyAISourceRow(json(row)) })).filter(Boolean) },
        };
        // Both selector orders come from PostgreSQL, including its ID collation.
        const reviews = assistant.length ? await db.aiAnswerReview.findMany({ where: reviewWhere,
            orderBy: [{ checkedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
        }) : [];
        const actionReviewIds = reviews.length ? (await db.aiAnswerReview.findMany({ where: { ...reviewWhere, state: { in: ['verified', 'notice'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } })).map(row => row.id) : [];

        return createHistoryReadSnapshot({ ownerId, surface, parentId, user, parent, rows, attachments, reviews, actionReviewIds, subscription, currentTime: time[0].currentTime }, dependencies);
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
}

/** Ordinary bundled reads use the existing service; external reads leave the snapshot behind. */
export function createSnapshotHistoryReader(snapshot, localService, liveService, concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error('Ordinary external reads require at most2 concurrent jobs');
    let active = 0;
    const waiting = [];
    const acquire = () => active < concurrency ? (active++, Promise.resolve()) : new Promise(resolve => waiting.push(resolve));
    const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
    return Object.freeze({ async get(owner, locator) {
        const result = await localService.get(owner, locator);
        if (!snapshot.requiresLiveRead(locator, result)) return result;
        await acquire();
        try { return await liveService.get(owner, locator); }
        finally { release(); }
    } });
}
