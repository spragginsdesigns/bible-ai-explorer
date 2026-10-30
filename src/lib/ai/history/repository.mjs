/** Owned, serializable history storage. The server injects its generated Prisma client. */
import { HistoryError } from './service.mjs';
import { isRetryableHistoryTransactionConflict } from './transaction-conflicts.mjs';
import { digest, historyAISourceRow } from './projection.mjs';
import { recoveredFreshActions } from './fresh-proof.mjs';
import {preparedReviewRecord} from './prepared-request.mjs';
const json = value => JSON.parse(JSON.stringify(value));
const bindingWhere = binding => Object.fromEntries(['sourceDigest', 'contextDigest', 'policyDigest', 'displayDigest', 'reviewDigest', 'envelopeDigest'].map(key => [key, binding[key]]));
export function createPrismaHistoryRepository(prisma, { hasCurrentAiConsent, readSubscription, loadDurableActionProof = async () => ({ complete: false, manifest: [] }) }) {
    if (typeof readSubscription !== 'function') throw new Error('DB-only subscription reader required');
    // DB-only callback contract: no provider, meter, or external effects inside this callback.
    // Every attempt opens a NEW transaction/snapshot and recomputes all owned reads and leases.
    return { async withOwnerLock(ownerId, callback) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    return await prisma.$transaction(async (db) => {
                const users = await db.$queryRaw `SELECT "id", "plan", "aiConsentVersion", "aiConsentAt" FROM "User" WHERE "id"=${ownerId} FOR UPDATE`;
                if (!users.length)
                    throw new HistoryError('not_found', 404);
                const user = users[0];
                const lockParent = async (locator) => {
                    const rows = locator.surface === 'chat' ? await db.$queryRaw `SELECT "id" FROM "Conversation" WHERE "id"=${locator.parentId} AND "userId"=${ownerId} FOR UPDATE` : await db.$queryRaw `SELECT "id" FROM "Note" WHERE "id"=${locator.parentId} AND "userId"=${ownerId} FOR UPDATE`;
                    return rows.length > 0;
                };
                const sourceWhere = locator => locator.surface === 'chat' ? { id: locator.messageId, conversationId: locator.parentId, conversation: { userId: ownerId } } : { id: locator.messageId, noteId: locator.parentId, note: { userId: ownerId } };
                const sourceTable = locator => locator.surface === 'chat' ? db.message : db.noteAIMessage;
                const sourceRef = locator => locator.surface === 'chat' ? { mainMessageId: locator.messageId } : { noteAiMessageId: locator.messageId };
                const tx = {
                    currentTime: async () => { const rows = await db.$queryRaw `SELECT clock_timestamp() AS "currentTime"`; return rows[0].currentTime; },
                    hasConsent: async () => hasCurrentAiConsent(user),
                    readPolicySnapshot: async () => ({user, subscription: await readSubscription(ownerId, db)}),
                    async loadOwnedTarget(locator) { if (!await lockParent(locator))
                        return null; const value = await sourceTable(locator).findFirst({ where: sourceWhere(locator) }); return value ? json(value) : null; },
                    async loadPreparedDependencies(locator, ids, attachmentIds) {
                        if(!await lockParent(locator))return{rows:[],attachments:[]};
                        const locks=locator.surface==='chat'?await db.$queryRaw`SELECT "id" FROM "Message" WHERE "conversationId"=${locator.parentId} AND "id"=ANY(${ids}::text[]) FOR UPDATE`:await db.$queryRaw`SELECT "id" FROM "NoteAIMessage" WHERE "noteId"=${locator.parentId} AND "id"=ANY(${ids}::text[]) FOR UPDATE`;
                        const rows=json(await sourceTable(locator).findMany({where:{id:{in:locks.map(row=>row.id)}}}));
                        if(locator.surface!=='chat'||!attachmentIds.length)return{rows,attachments:[]};
                        const attachmentLocks=await db.$queryRaw`SELECT "id" FROM "ChatAttachment" WHERE "userId"=${ownerId} AND "messageId"=ANY(${ids}::text[]) AND "id"=ANY(${attachmentIds}::text[]) FOR UPDATE`;
                        const attachments=json(await db.chatAttachment.findMany({where:{id:{in:attachmentLocks.map(row=>row.id)}},select:{id:true,userId:true,messageId:true,pathname:true,filename:true,mediaType:true,size:true,etag:true,status:true,transcript:true,durationSeconds:true}}));
                        return{rows,attachments};
                    },
                    async loadPreparedReview(locator){
                        const target=await tx.loadOwnedTarget(locator);if(!target)return null;
                        const source={surface:locator.surface,parentId:locator.parentId,ownerId,row:historyAISourceRow(target)};
                        // A later explicit legacy recheck can supersede a fresh
                        // request certificate. Do not keep selecting an older
                        // retired/stale prepared context after that succeeds.
                        const record=await db.aiAnswerReview.findFirst({where:{ownerId,...sourceRef(locator),sourceDigest:digest(source),state:'verified'},orderBy:[{checkedAt:{sort:'desc',nulls:'last'}},{createdAt:'desc'},{id:'desc'}]});
                        return record?preparedReviewRecord(record,source):null;
                    },
                    async loadOwnedBundle(locator, maxRows) {
                        if (!await lockParent(locator))
                            return null;
                        const target = await sourceTable(locator).findFirst({ where: sourceWhere(locator) });
                        if (!target)
                            return null;
                        // Parent FOR UPDATE blocks new FK-linked prefix inserts during this short checkpoint.
                        // Prefix row FOR UPDATE also blocks same-ID upserts/deletes until digest/CAS commit.
                        const locked = locator.surface === 'chat' ? await db.$queryRaw `SELECT "id" FROM "Message" WHERE "conversationId"=${locator.parentId} AND "createdAt"<=${target.createdAt} ORDER BY "createdAt","id" LIMIT ${maxRows + 1} FOR UPDATE` : await db.$queryRaw `SELECT "id" FROM "NoteAIMessage" WHERE "noteId"=${locator.parentId} AND "createdAt"<=${target.createdAt} ORDER BY "createdAt","id" LIMIT ${maxRows + 1} FOR UPDATE`;
                        const prefix = await sourceTable(locator).findMany({ where: { id: { in: locked.map(row => row.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
                        if (!locked.some(row => row.id === locator.messageId)) {
                            const targetLocks = locator.surface === 'chat' ? await db.$queryRaw `SELECT "id" FROM "Message" WHERE "id"=${locator.messageId} AND "conversationId"=${locator.parentId} FOR UPDATE` : await db.$queryRaw `SELECT "id" FROM "NoteAIMessage" WHERE "id"=${locator.messageId} AND "noteId"=${locator.parentId} FOR UPDATE`;
                            if (!targetLocks.length)
                                return null;
                        }
                        const refreshed = await sourceTable(locator).findFirst({ where: sourceWhere(locator) });
                        if (!refreshed)
                            return null;
                        const attachmentsPresent = locator.surface === 'chat' && await db.chatAttachment.count({ where: { messageId: { in: locked.map(row => row.id) } } }) > 0;
                        return { target: json(refreshed), prefix: json(prefix), complete: locked.length <= maxRows && refreshed.createdAt.getTime() === target.createdAt.getTime(), attachmentsPresent };
                    },
                    async loadFreshBundle(locator, draft, maxRows) {
                        if (!await lockParent(locator)) return null;
                        if (draft.operation) {
                            if (locator.surface!=='note'||draft.operation.userId!==ownerId||draft.operation.noteId!==locator.parentId) throw new HistoryError('source_changed',409);
                            const operations=await db.$queryRaw`SELECT "id","state" FROM "NoteAIOperation" WHERE "id"=${draft.operation.id} AND "userId"=${ownerId} AND "noteId"=${locator.parentId} FOR UPDATE`;
                            if (operations.length!==1||operations[0].state!=='running') throw new HistoryError('source_changed',409);
                        }
                        const existing = await sourceTable(locator).findUnique({where: {id: locator.messageId}});
                        if (existing && (existing.role !== 'assistant' || (locator.surface === 'chat' ? existing.conversationId : existing.noteId) !== locator.parentId)) throw new HistoryError('not_found',404);
                        const current = await tx.currentTime();
                        const target = existing ? {...json(existing), content: draft.content, metadata: json(draft.metadata)} : {
                            id: locator.messageId, role: 'assistant', content: draft.content, metadata: json(draft.metadata), createdAt: draft.createdAt ?? current.toISOString(),
                            ...(locator.surface === 'chat' ? {conversationId: locator.parentId, feedback: null, feedbackReason: null, feedbackTags: [], feedbackAt: null, feedbackReviewedAt: null} : {noteId: locator.parentId}),
                        };
                        const at = new Date(target.createdAt);
                        const locked = draft.sourceWindow ? (await tx.loadPreparedDependencies(locator,draft.sourceWindow,[])).rows : locator.surface === 'chat' ? await db.$queryRaw`SELECT "id" FROM "Message" WHERE "conversationId"=${locator.parentId} AND "createdAt"<=${at} AND "id"<>${locator.messageId} ORDER BY "createdAt","id" LIMIT ${maxRows} FOR UPDATE` : await db.$queryRaw`SELECT "id" FROM "NoteAIMessage" WHERE "noteId"=${locator.parentId} AND "createdAt"<=${at} AND "id"<>${locator.messageId} ORDER BY "createdAt","id" LIMIT ${maxRows} FOR UPDATE`;
                        const prefix = json(await sourceTable(locator).findMany({where: {id: {in: locked.map(row=>row.id)}}, orderBy: [{createdAt:'asc'},{id:'asc'}]}));
                        const attachmentsPresent = locator.surface === 'chat' && await db.chatAttachment.count({where: {messageId: {in: locked.map(row=>row.id)}}}) > 0;
                        return {target, previous: existing ? json(existing) : null, prefix: [...prefix,target].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)), complete: draft.sourceWindow?locked.length===draft.sourceWindow.length:locked.length < maxRows, attachmentsPresent};
                    },
                    async saveFreshTarget(locator, target) {
                        const values = {content: target.content, metadata: target.metadata};
                        return json(await sourceTable(locator).upsert({where: {id: locator.messageId},update: values,create: {id: locator.messageId, role:'assistant',...values,createdAt: new Date(target.createdAt),...(locator.surface==='chat'?{conversationId:locator.parentId}:{noteId:locator.parentId})}}));
                    },
                    async loadDurableActionProof(locator, actions) {
                        const durable = await loadDurableActionProof({ db, ownerId, locator, actions });
                        if (durable.complete) return durable;
                        const target = await tx.loadOwnedTarget(locator);
                        if (!target) return {complete:false,manifest:[]};
                        const source = {surface:locator.surface,parentId:locator.parentId,ownerId,row:historyAISourceRow(target)};
                        const records = await db.aiAnswerReview.findMany({where:{ownerId,...sourceRef(locator),sourceDigest:digest(source),state:{in:['verified','notice']}},orderBy:{createdAt:'desc'},take:20});
                        for (const record of records) {
                            const manifest = recoveredFreshActions(record,source,actions);
                            if (manifest) return {complete:true,manifest};
                        }
                        return {complete:false,manifest:[]};
                    },
                    findBinding: binding => db.aiAnswerReview.findFirst({ where: { ownerId, ...bindingWhere(binding) } }),
                    activeLease: current => db.aiAnswerReview.findFirst({ where: { ownerId, state: 'pending', expiresAt: { gt: current } } }),
                    expireLeases: current => db.aiAnswerReview.updateMany({ where: { ownerId, state: 'pending', expiresAt: { lte: current } }, data: { state: 'withheld', leaseToken: null, expiresAt: null, issueCodes: ['lease_expired'], retryAfter: current, updatedAt: current, checkedAt: current } }),
                    createReview: data => db.aiAnswerReview.create({ data }),
                    async certifyFreshReview(id, data) {
                        const result = await db.aiAnswerReview.updateMany({where:{id,ownerId,state:{in:['pending','withheld']}},data:{...data,leaseToken:null,expiresAt:null}});
                        return result.count===1;
                    },
                    async retryLease(id, { leaseToken, expiresAt, now }) {
                        const result = await db.aiAnswerReview.updateMany({ where: { id, ownerId, state: 'withheld', retryAfter: { lte: now } }, data: { state: 'pending', leaseToken, expiresAt, retryAfter: null, issueCodes: [], canonicalPassed: false, semanticPassed: false, actionProofPassed: false, reviewerModelId: null, attemptCount: { increment: 1 }, updatedAt: now, checkedAt: null } });
                        return result.count ? db.aiAnswerReview.findFirst({ where: { id, ownerId } }) : null;
                    },
                    findLease: (id, leaseToken, current) => db.aiAnswerReview.findFirst({ where: { id, ownerId, state: 'pending', leaseToken, expiresAt: { gt: current } } }),
                    async finishLease(id, leaseToken, current, data) {
                        const result = await db.aiAnswerReview.updateMany({ where: { id, ownerId, state: 'pending', leaseToken, expiresAt: { gt: current } }, data: { ...data, leaseToken: null, expiresAt: null, checkedAt: current, updatedAt: current } });
                        return result.count === 1;
                    },
                    async targetVersions(locator, reviewId, take, after = null) {
                        const where = { ownerId, ...sourceRef(locator), ...(reviewId ? { id: reviewId } : {}) };
                        if (after && !await db.aiAnswerReview.findFirst({ where: { ownerId, ...sourceRef(locator), id: after } }))
                            throw new HistoryError('not_found', 404);
                        return db.aiAnswerReview.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
                    },
                };
                return callback(tx);
                    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
                } catch (error) {
                    if (!isRetryableHistoryTransactionConflict(error) || attempt === 2) throw error;
                    await new Promise(resolve => setTimeout(resolve, [10, 25][attempt]));
                }
            }
        } };
}
