-- Additive only: no private content is transformed by this migration.
ALTER TABLE "VerseOfDay" ADD COLUMN "audioSourcePathname" TEXT, ADD COLUMN "audioSourceEtag" TEXT;
ALTER TABLE "ChatAttachment" ADD COLUMN "storageFormat" TEXT NOT NULL DEFAULT 'plain', ADD COLUMN "sourcePathname" TEXT, ADD COLUMN "sourceEtag" TEXT;
CREATE TABLE "PrivateDataKey" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "encryptedKey" TEXT NOT NULL, "kmsKeyArn" TEXT NOT NULL, "enrolledAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PrivateDataKey_pkey" PRIMARY KEY ("id"));
ALTER TABLE "PrivateDataKey" ADD CONSTRAINT "PrivateDataKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateDataKey" ADD COLUMN "migrationCompletedAt" TIMESTAMP(3);
CREATE TABLE "NoteSearchSource" ("noteId" TEXT NOT NULL, "userId" TEXT NOT NULL, "title" TEXT NOT NULL, "plainText" TEXT NOT NULL, CONSTRAINT "NoteSearchSource_pkey" PRIMARY KEY ("noteId"));
ALTER TABLE "NoteSearchSource" ADD CONSTRAINT "NoteSearchSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "SupportGrant" ("id" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SupportGrant_pkey" PRIMARY KEY ("id"));
ALTER TABLE "SupportGrant" ADD CONSTRAINT "SupportGrant_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "SupportSession" ("id" TEXT NOT NULL, "actorUserId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "grantId" TEXT, "mode" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT NOT NULL, "reason" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id"));
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "PrivacyAuditEvent" ("id" TEXT NOT NULL, "actorUserId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "sessionId" TEXT, "grantId" TEXT, "action" TEXT NOT NULL, "resourceType" TEXT, "resourceId" TEXT, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PrivacyAuditEvent_pkey" PRIMARY KEY ("id"));
ALTER TABLE "PrivacyAuditEvent" ADD CONSTRAINT "PrivacyAuditEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "PrivacyNotice" ("id" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL, "sessionId" TEXT, "message" TEXT NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PrivacyNotice_pkey" PRIMARY KEY ("id"));
ALTER TABLE "PrivacyNotice" ADD CONSTRAINT "PrivacyNotice_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteSearchSource" ADD CONSTRAINT "NoteSearchSource_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PrivateDataKey_userId_key" ON "PrivateDataKey"("userId");
CREATE INDEX "NoteSearchSource_userId_idx" ON "NoteSearchSource"("userId");
CREATE INDEX "SupportGrant_ownerUserId_expiresAt_revokedAt_idx" ON "SupportGrant"("ownerUserId","expiresAt","revokedAt");
CREATE INDEX "SupportSession_actorUserId_ownerUserId_expiresAt_idx" ON "SupportSession"("actorUserId","ownerUserId","expiresAt");
CREATE INDEX "SupportSession_grantId_idx" ON "SupportSession"("grantId");
CREATE INDEX "PrivacyAuditEvent_ownerUserId_createdAt_idx" ON "PrivacyAuditEvent"("ownerUserId","createdAt");
CREATE INDEX "PrivacyAuditEvent_sessionId_idx" ON "PrivacyAuditEvent"("sessionId");
CREATE INDEX "PrivacyNotice_ownerUserId_createdAt_idx" ON "PrivacyNotice"("ownerUserId","createdAt");
-- PUBLIC must never gain incidental access to the sensitive search/key/support stores.
REVOKE ALL ON "PrivateDataKey", "NoteSearchSource", "SupportGrant", "SupportSession", "PrivacyAuditEvent", "PrivacyNotice" FROM PUBLIC;
