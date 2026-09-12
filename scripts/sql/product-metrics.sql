-- SureWord product metrics, weekly.
--
-- Read-only. Run by hand against production (Neon project `versemind`,
-- database `neondb`); confirm `SELECT current_database()` first, because the
-- empty decoy database has the same schema and returns zeros without erroring.
-- Every statement below is a standalone SELECT: nothing is created, written,
-- or migrated, so it is safe to paste one section at a time.
--
-- Conventions shared by every section:
-- * Prisma stores DateTime as `timestamp without time zone` holding UTC, so a
--   local calendar day is `(ts AT TIME ZONE 'UTC' AT TIME ZONE
--   'America/Los_Angeles')::date`. Weeks are Monday-start in that zone.
-- * The seeded answer-eval run on 2026-08-27 (17 conversations, one repeated
--   question) is excluded wherever messages or conversations are counted. It
--   was a quality test, not usage, and it would otherwise read as a spike in
--   depth, tool fires and activity for that week. The CTE is repeated per
--   section so each one still runs on its own.


-- ---------------------------------------------------------------------------
-- 1. Weekly new accounts
-- A User row is created on first authenticated API call, so this is "first
-- use", not Clerk sign-up.
-- ---------------------------------------------------------------------------
SELECT
	date_trunc('week', (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
	count(*) AS new_accounts
FROM "User" u
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 2. Day-1 and day-7 return per signup week
-- Active = any user chat message, chapter read, highlight created or changed,
-- or note created or changed, on a Los Angeles calendar day. "Returned on day
-- N" means active exactly N days after the signup day. A user only counts in
-- the denominator once that day has fully passed, so the newest week is not
-- dragged toward zero by people who have not had the chance to return yet.
-- ---------------------------------------------------------------------------
WITH eval_conversations AS (
	SELECT DISTINCT m."conversationId" AS id
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE c."userId" = 'user_3Hk7fPXucIYEZzeWsSpvpUwgoJx'
		AND m.role = 'user'
		AND m.content = 'What does Psalm 23 teach about trusting the Lord?'
		AND m."createdAt" >= TIMESTAMP '2026-08-27 00:00:00'
		AND m."createdAt" < TIMESTAMP '2026-08-28 00:00:00'
),
activity AS (
	SELECT c."userId" AS user_id, (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS day
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE m.role = 'user' AND m."conversationId" NOT IN (SELECT id FROM eval_conversations)
	UNION
	SELECT r."userId", (r."readAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "ReadingEvent" r
	UNION
	SELECT h."userId", (h."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "VerseHighlight" h
	UNION
	SELECT h."userId", (h."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "VerseHighlight" h
	UNION
	SELECT n."userId", (n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "Note" n
	UNION
	SELECT n."userId", (n."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "Note" n
),
signups AS (
	SELECT u.id AS user_id, (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS signup_day
	FROM "User" u
),
today AS (
	SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS day
),
cohort AS (
	SELECT
		date_trunc('week', s.signup_day)::date AS signup_week,
		count(*) AS signups,
		count(*) FILTER (WHERE s.signup_day + 1 < t.day) AS d1_eligible,
		count(*) FILTER (
			WHERE s.signup_day + 1 < t.day
				AND EXISTS (SELECT 1 FROM activity a WHERE a.user_id = s.user_id AND a.day = s.signup_day + 1)
		) AS d1_returned,
		count(*) FILTER (WHERE s.signup_day + 7 < t.day) AS d7_eligible,
		count(*) FILTER (
			WHERE s.signup_day + 7 < t.day
				AND EXISTS (SELECT 1 FROM activity a WHERE a.user_id = s.user_id AND a.day = s.signup_day + 7)
		) AS d7_returned
	FROM signups s
	CROSS JOIN today t
	GROUP BY 1
)
SELECT
	signup_week,
	signups,
	d1_eligible,
	d1_returned,
	round(100.0 * d1_returned / nullif(d1_eligible, 0), 1) AS d1_return_pct,
	d7_eligible,
	d7_returned,
	round(100.0 * d7_returned / nullif(d7_eligible, 0), 1) AS d7_return_pct
FROM cohort
ORDER BY signup_week;


-- ---------------------------------------------------------------------------
-- 3. Weekly active users
-- Same activity definition as section 2, with a per-surface breakdown so a
-- change in the total can be traced to chat, reading, highlights or notes.
-- The surface columns overlap and do not sum to the total.
-- ---------------------------------------------------------------------------
WITH eval_conversations AS (
	SELECT DISTINCT m."conversationId" AS id
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE c."userId" = 'user_3Hk7fPXucIYEZzeWsSpvpUwgoJx'
		AND m.role = 'user'
		AND m.content = 'What does Psalm 23 teach about trusting the Lord?'
		AND m."createdAt" >= TIMESTAMP '2026-08-27 00:00:00'
		AND m."createdAt" < TIMESTAMP '2026-08-28 00:00:00'
),
activity AS (
	SELECT c."userId" AS user_id, 'chat' AS source, (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS day
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE m.role = 'user' AND m."conversationId" NOT IN (SELECT id FROM eval_conversations)
	UNION ALL
	SELECT r."userId", 'reading', (r."readAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "ReadingEvent" r
	UNION ALL
	SELECT h."userId", 'highlight', (h."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "VerseHighlight" h
	UNION ALL
	SELECT h."userId", 'highlight', (h."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "VerseHighlight" h
	UNION ALL
	SELECT n."userId", 'note', (n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "Note" n
	UNION ALL
	SELECT n."userId", 'note', (n."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM "Note" n
)
SELECT
	date_trunc('week', a.day)::date AS week,
	count(DISTINCT a.user_id) AS weekly_active_users,
	count(DISTINCT a.user_id) FILTER (WHERE a.source = 'chat') AS chat_users,
	count(DISTINCT a.user_id) FILTER (WHERE a.source = 'reading') AS reading_users,
	count(DISTINCT a.user_id) FILTER (WHERE a.source = 'highlight') AS highlight_users,
	count(DISTINCT a.user_id) FILTER (WHERE a.source = 'note') AS note_users
FROM activity a
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 4. Conversation depth distribution per week
-- Depth = user turns in the conversation, bucketed by the week the
-- conversation was created. A turn saved twice by a retry upserts the same
-- message id, so retries do not inflate depth.
-- ---------------------------------------------------------------------------
WITH eval_conversations AS (
	SELECT DISTINCT m."conversationId" AS id
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE c."userId" = 'user_3Hk7fPXucIYEZzeWsSpvpUwgoJx'
		AND m.role = 'user'
		AND m.content = 'What does Psalm 23 teach about trusting the Lord?'
		AND m."createdAt" >= TIMESTAMP '2026-08-27 00:00:00'
		AND m."createdAt" < TIMESTAMP '2026-08-28 00:00:00'
),
depth AS (
	SELECT
		c.id,
		date_trunc('week', (c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
		count(m.id) FILTER (WHERE m.role = 'user') AS user_turns
	FROM "Conversation" c
	LEFT JOIN "Message" m ON m."conversationId" = c.id
	WHERE c.id NOT IN (SELECT id FROM eval_conversations)
	GROUP BY c.id, 2
)
SELECT
	week,
	count(*) AS conversations,
	count(*) FILTER (WHERE user_turns = 0) AS turns_0,
	count(*) FILTER (WHERE user_turns = 1) AS turns_1,
	count(*) FILTER (WHERE user_turns = 2) AS turns_2,
	count(*) FILTER (WHERE user_turns BETWEEN 3 AND 5) AS turns_3_5,
	count(*) FILTER (WHERE user_turns BETWEEN 6 AND 10) AS turns_6_10,
	count(*) FILTER (WHERE user_turns > 10) AS turns_11_plus,
	percentile_cont(0.5) WITHIN GROUP (ORDER BY user_turns) AS median_user_turns,
	round(avg(user_turns), 2) AS mean_user_turns
FROM depth
GROUP BY week
ORDER BY week;


-- ---------------------------------------------------------------------------
-- 5. Unanswered conversations per week
-- Conversation level: at least one user message and no assistant message at
-- all, by conversation creation week (the number the chat outcome metric in
-- src/lib/ai/chat-metrics.ts exists to explain).
-- Turn level: a user message whose next message in the same conversation is
-- not an assistant message, by the user message's week. This also catches a
-- failed answer in the middle of an otherwise healthy thread. A question
-- still being answered while this runs counts as unanswered for that moment.
-- ---------------------------------------------------------------------------
WITH eval_conversations AS (
	SELECT DISTINCT m."conversationId" AS id
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE c."userId" = 'user_3Hk7fPXucIYEZzeWsSpvpUwgoJx'
		AND m.role = 'user'
		AND m.content = 'What does Psalm 23 teach about trusting the Lord?'
		AND m."createdAt" >= TIMESTAMP '2026-08-27 00:00:00'
		AND m."createdAt" < TIMESTAMP '2026-08-28 00:00:00'
),
conversation_level AS (
	SELECT
		date_trunc('week', (c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
		count(*) FILTER (WHERE EXISTS (
			SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.role = 'user'
		)) AS conversations_with_question,
		count(*) FILTER (WHERE
			EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.role = 'user')
			AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.role = 'assistant')
		) AS unanswered_conversations,
		count(DISTINCT c."userId") FILTER (WHERE
			EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.role = 'user')
			AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.role = 'assistant')
		) AS users_with_unanswered_conversation
	FROM "Conversation" c
	WHERE c.id NOT IN (SELECT id FROM eval_conversations)
	GROUP BY 1
),
ordered AS (
	SELECT
		m.role,
		m."createdAt",
		lead(m.role) OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt", m.id) AS next_role
	FROM "Message" m
	WHERE m."conversationId" NOT IN (SELECT id FROM eval_conversations)
),
turn_level AS (
	SELECT
		date_trunc('week', (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
		count(*) AS user_turns,
		count(*) FILTER (WHERE o.next_role IS DISTINCT FROM 'assistant') AS unanswered_turns
	FROM ordered o
	WHERE o.role = 'user'
	GROUP BY 1
)
SELECT
	coalesce(cl.week, tl.week) AS week,
	coalesce(cl.conversations_with_question, 0) AS conversations_with_question,
	coalesce(cl.unanswered_conversations, 0) AS unanswered_conversations,
	round(100.0 * cl.unanswered_conversations / nullif(cl.conversations_with_question, 0), 1) AS unanswered_conversation_pct,
	coalesce(cl.users_with_unanswered_conversation, 0) AS users_with_unanswered_conversation,
	coalesce(tl.user_turns, 0) AS user_turns,
	coalesce(tl.unanswered_turns, 0) AS unanswered_turns,
	round(100.0 * tl.unanswered_turns / nullif(tl.user_turns, 0), 1) AS unanswered_turn_pct
FROM conversation_level cl
FULL JOIN turn_level tl ON tl.week = cl.week
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- 6. Tool fires by tool name per week
-- One row per tool part persisted in an assistant message's metadata.parts.
-- Static tools are stored as type 'tool-<name>'; 'dynamic-tool' parts carry
-- the name in toolName. Rows written before metadata.parts existed have no
-- parts and contribute nothing, so early weeks undercount.
-- ---------------------------------------------------------------------------
WITH eval_conversations AS (
	SELECT DISTINCT m."conversationId" AS id
	FROM "Message" m
	JOIN "Conversation" c ON c.id = m."conversationId"
	WHERE c."userId" = 'user_3Hk7fPXucIYEZzeWsSpvpUwgoJx'
		AND m.role = 'user'
		AND m.content = 'What does Psalm 23 teach about trusting the Lord?'
		AND m."createdAt" >= TIMESTAMP '2026-08-27 00:00:00'
		AND m."createdAt" < TIMESTAMP '2026-08-28 00:00:00'
)
SELECT
	date_trunc('week', (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
	CASE
		WHEN p->>'type' = 'dynamic-tool' THEN coalesce(p->>'toolName', 'dynamic-tool')
		ELSE substr(p->>'type', 6)
	END AS tool_name,
	count(*) AS fires,
	count(*) FILTER (WHERE p->>'state' = 'output-error') AS errors,
	count(DISTINCT m.id) AS answers_using_tool,
	count(DISTINCT c."userId") AS users
FROM "Message" m
JOIN "Conversation" c ON c.id = m."conversationId"
CROSS JOIN LATERAL jsonb_array_elements(
	CASE WHEN jsonb_typeof(m.metadata->'parts') = 'array' THEN m.metadata->'parts' ELSE '[]'::jsonb END
) AS p
WHERE m.role = 'assistant'
	AND m."conversationId" NOT IN (SELECT id FROM eval_conversations)
	AND (p->>'type' LIKE 'tool-%' OR p->>'type' = 'dynamic-tool')
GROUP BY 1, 2
ORDER BY 1, fires DESC, tool_name;


-- ---------------------------------------------------------------------------
-- 7. Accounts that got a daily cross per week
-- One VerseOfDay row is one day's cross picked for one user (the morning cron
-- or an on-demand open). Fallback and Listen columns show how many of those
-- days were the degraded pick or carried a ready spoken devotional.
-- ---------------------------------------------------------------------------
SELECT
	date_trunc('week', (v."sentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'))::date AS week,
	count(DISTINCT v."userId") AS accounts_with_daily_cross,
	count(*) AS daily_crosses,
	count(*) FILTER (WHERE v."isFallback" IS TRUE) AS fallback_crosses,
	count(*) FILTER (WHERE v."audioStatus" = 'ready') AS listen_ready_crosses
FROM "VerseOfDay" v
GROUP BY 1
ORDER BY 1;
