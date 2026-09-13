-- Keep new preference reads behind the usage flag. Existing User queries
-- remain compatible before this feature's migrations are deployed.
CREATE TABLE "AiPreference" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "includedAiPreferred" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "AiPreference" ("userId", "includedAiPreferred")
SELECT "id", "includedAiPreferred" FROM "User" WHERE "includedAiPreferred" = true;
ALTER TABLE "User" DROP COLUMN "includedAiPreferred";
