-- Existing key owners keep BYOK. New accounts default to included AI, and
-- adding/removing a key must not silently change an explicit payer choice.
INSERT INTO "AiPreference" ("userId", "includedAiPreferred")
SELECT DISTINCT "userId", false FROM "ProviderCredential"
ON CONFLICT ("userId") DO NOTHING;
