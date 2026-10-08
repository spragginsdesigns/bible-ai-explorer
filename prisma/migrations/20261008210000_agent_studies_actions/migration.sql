CREATE TABLE "AgentStudy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "sourceMessageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentStudy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentStudy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentStudy_userId_sourceMessageId_key" ON "AgentStudy"("userId", "sourceMessageId");
CREATE INDEX "AgentStudy_userId_updatedAt_idx" ON "AgentStudy"("userId", "updatedAt");

CREATE TABLE "AgentAction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "proposalMessageId" TEXT NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "approvedMessageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentAction_userId_scope_key" ON "AgentAction"("userId", "scope");
