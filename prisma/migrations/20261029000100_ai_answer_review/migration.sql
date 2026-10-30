-- Additive saved-answer review sidecar. Existing message and note source rows remain unchanged.
CREATE TYPE "AiAnswerReviewState" AS ENUM ('pending','verified','withheld','notice');
CREATE TABLE "AiAnswerReview" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL,
 "mainMessageId" TEXT, "noteAiMessageId" TEXT,
 "sourceDigest" CHAR(64) NOT NULL, "contextDigest" CHAR(64) NOT NULL,
 "policyDigest" CHAR(64) NOT NULL, "displayDigest" CHAR(64) NOT NULL,
 "reviewDigest" CHAR(64) NOT NULL, "envelopeDigest" CHAR(64) NOT NULL,
 "state" "AiAnswerReviewState" NOT NULL DEFAULT 'pending',
 "sourceSnapshot" JSONB NOT NULL, "sanitizedDisplay" JSONB NOT NULL, "freshEvidence" JSONB,
 "requiresActionProof" BOOLEAN NOT NULL DEFAULT false,
 "canonicalPassed" BOOLEAN NOT NULL DEFAULT false, "semanticPassed" BOOLEAN NOT NULL DEFAULT false,
 "actionProofPassed" BOOLEAN NOT NULL DEFAULT false,
 "reviewerModelId" TEXT, "issueCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "leaseToken" UUID, "expiresAt" TIMESTAMP(3), "retryAfter" TIMESTAMP(3),
 "attemptCount" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "checkedAt" TIMESTAMP(3),
 CONSTRAINT "AiAnswerReview_owner_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AiAnswerReview_main_fkey" FOREIGN KEY ("mainMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AiAnswerReview_note_fkey" FOREIGN KEY ("noteAiMessageId") REFERENCES "NoteAIMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AiAnswerReview_exactly_one_source" CHECK (("mainMessageId" IS NOT NULL)::int + ("noteAiMessageId" IS NOT NULL)::int = 1),
 CONSTRAINT "AiAnswerReview_lease_shape" CHECK (("state" = 'pending' AND "leaseToken" IS NOT NULL AND "expiresAt" IS NOT NULL) OR ("state" <> 'pending' AND "leaseToken" IS NULL AND "expiresAt" IS NULL)),
 CONSTRAINT "AiAnswerReview_proof_shape" CHECK ("state" <> 'verified' OR ("canonicalPassed" AND "semanticPassed" AND (NOT "requiresActionProof" OR "actionProofPassed") AND "reviewerModelId" IS NOT NULL AND cardinality("issueCodes") = 0)),
 CONSTRAINT "AiAnswerReview_content_free_codes" CHECK (array_position("issueCodes",NULL) IS NULL AND "issueCodes" <@ ARRAY['not_found','not_assistant','source_changed','context_changed','policy_changed','consent_required','pending','account_busy','lease_expired','retry_later','source_limit','context_limit','context_incomplete','context_ambiguous','missing_question','unknown_translation','unsupported_attachment_context','projection_refused','notice_has_unreviewed_extras','action_proof_missing','canonical_rejected','semantic_rejected','review_changed_text','reviewer_changed','verification_unavailable','verification_timeout','quota_exhausted','stale_lease','original_limit','review_required','unversioned_corpus']::TEXT[]),
 CONSTRAINT "AiAnswerReview_digest_shape" CHECK (
 "sourceDigest" ~ '^[a-f0-9]{64}$' AND "contextDigest" ~ '^[a-f0-9]{64}$' AND "policyDigest" ~ '^[a-f0-9]{64}$' AND
 "displayDigest" ~ '^[a-f0-9]{64}$' AND "reviewDigest" ~ '^[a-f0-9]{64}$' AND "envelopeDigest" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "AiAnswerReview_owner_binding_key" ON "AiAnswerReview" ("ownerId","sourceDigest","contextDigest","policyDigest","displayDigest","reviewDigest","envelopeDigest");
-- Expiry is cleaned under the User row lock before claim. A partial index cannot safely use now().
CREATE UNIQUE INDEX "AiAnswerReview_one_pending_owner" ON "AiAnswerReview" ("ownerId") WHERE "state" = 'pending';
CREATE INDEX "AiAnswerReview_owner_state_expiry" ON "AiAnswerReview" ("ownerId","state","expiresAt");
CREATE INDEX "AiAnswerReview_main_created" ON "AiAnswerReview" ("mainMessageId","createdAt");
CREATE INDEX "AiAnswerReview_note_created" ON "AiAnswerReview" ("noteAiMessageId","createdAt");

CREATE FUNCTION "AiAnswerReview_guard_payload"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_pk_cascade boolean := false;
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
     -- FK-cascade checkpoint only. Authentication is outside SQL. Parent cascade order is unspecified.
     IF EXISTS (SELECT 1 FROM "User" WHERE id=OLD."ownerId") OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."ownerId") THEN
       RAISE EXCEPTION 'Direct review owner reassignment is forbidden';
     END IF;
     owner_pk_cascade := true;
   END IF;
   -- Source IDs and EVERY source/display/digest binding remain immutable, including during owner PK cascades.
   IF ROW(NEW."mainMessageId",NEW."noteAiMessageId",NEW."sourceDigest",NEW."contextDigest",NEW."policyDigest",NEW."displayDigest",NEW."reviewDigest",NEW."envelopeDigest",NEW."sourceSnapshot",NEW."sanitizedDisplay",NEW."freshEvidence",NEW."requiresActionProof") IS DISTINCT FROM ROW(OLD."mainMessageId",OLD."noteAiMessageId",OLD."sourceDigest",OLD."contextDigest",OLD."policyDigest",OLD."displayDigest",OLD."reviewDigest",OLD."envelopeDigest",OLD."sourceSnapshot",OLD."sanitizedDisplay",OLD."freshEvidence",OLD."requiresActionProof") THEN
     RAISE EXCEPTION 'Review payload is immutable';
   END IF;
   IF OLD."state" IN ('verified','notice') AND NEW."state" <> OLD."state" THEN RAISE EXCEPTION 'Terminal approved review cannot be reopened'; END IF;
   IF owner_pk_cascade AND OLD."state" = 'pending' THEN
     NEW."state" := 'withheld'; NEW."issueCodes" := ARRAY['source_changed'];
     NEW."leaseToken" := NULL; NEW."expiresAt" := NULL; NEW."retryAfter" := NULL;
     NEW."canonicalPassed" := false; NEW."semanticPassed" := false; NEW."actionProofPassed" := false;
     NEW."reviewerModelId" := NULL; NEW."checkedAt" := CURRENT_TIMESTAMP; NEW."updatedAt" := CURRENT_TIMESTAMP;
   END IF;
 END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW."mainMessageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE m.id=NEW."mainMessageId" AND c."userId"=NEW."ownerId") THEN RAISE EXCEPTION 'Review source ownership mismatch'; END IF;
   IF NEW."noteAiMessageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NoteAIMessage" m JOIN "Note" n ON n.id=m."noteId" WHERE m.id=NEW."noteAiMessageId" AND n."userId"=NEW."ownerId") THEN RAISE EXCEPTION 'Review source ownership mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AiAnswerReview_guard_payload_trigger" BEFORE INSERT OR UPDATE ON "AiAnswerReview" FOR EACH ROW EXECUTE FUNCTION "AiAnswerReview_guard_payload"();
-- Owner PK cascades preserve historical snapshots/bindings; current owner binding must be recomputed.
-- Snapshot/display/bindings are write-once. Operational state/lease may change for bounded transient retry.
-- Existing verified/notice decisions are never reopened by this service. No prefix row content is persisted here.
