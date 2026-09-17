-- Answer feedback reason chips (docs/FEATURES.md, "Answer feedback, and how it
-- reaches the doctrinal eval harness"): the ids a thumbs down was tagged with,
-- from FEEDBACK_TAGS in src/lib/chat/answer-feedback.ts. A scalar list rather
-- than a prefix on feedbackReason so product-metrics.sql can unnest and count
-- which failure people report most.

ALTER TABLE "Message"
    ADD COLUMN "feedbackTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
