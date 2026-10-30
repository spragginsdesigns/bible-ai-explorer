import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIN_SECONDS = 15;
const CLAIM_WINDOW_MS = 30_000;

function failure(code, message) {
	return Object.assign(new Error(message), { code });
}

function timestamp(value = Date.now()) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15 - 86_400_000) throw new TypeError("Invalid ledger timestamp.");
	return value;
}

function identifier(value, name) {
	if (typeof value !== "string" || !value.trim() || value.length > 512) throw new TypeError(`Invalid ${name}.`);
	return value;
}

function checkedLimits(limits) {
	for (const key of ["sessionSeconds", "dailySeconds", "monthlySeconds"]) {
		if (!Number.isFinite(limits?.[key]) || limits[key] < 0 || limits[key] > Number.MAX_SAFE_INTEGER / 1000) throw new TypeError(`Invalid ${key}.`);
	}
	return limits;
}

function windows(now) {
	const date = new Date(now);
	const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
	return { day, month, end: Math.min(day + 86_400_000, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) };
}

function grant(row) {
	if (!row) return null;
	return { ...row, confirmed: row.confirmed === null ? null : row.confirmed === 1 };
}

function turn(row) {
	if (!row) return null;
	const { resultJson, ...rest } = row;
	return { ...rest, ...(resultJson === null ? {} : { result: JSON.parse(resultJson) }) };
}

/** Single-host prototype only. All callers must share this durable file. */
export function openLiveLedger(path) {
	if (typeof path !== "string" || !path || path === ":memory:") throw new TypeError("A durable ledger file path is required.");
	const filename = resolve(path);
	const directory = dirname(filename);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	// Never chmod a shared caller directory (for example /tmp) as a side effect.
	const directoryStat = lstatSync(directory);
	if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) throw new Error("Use a private 0700 directory for the live ledger.");
	const fd = openSync(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
	closeSync(fd);
	if (!statSync(filename).isFile()) throw new Error("The live ledger must be a regular file.");
	chmodSync(filename, 0o600);
	const db = new DatabaseSync(filename);
	try {
		db.exec(`PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;
			CREATE TABLE IF NOT EXISTS live_sessions (
				id TEXT PRIMARY KEY, userId TEXT NOT NULL, clerkSessionId TEXT NOT NULL,
				conversationId TEXT NOT NULL, seconds INTEGER NOT NULL CHECK(seconds >= 15),
				chargedSeconds REAL NOT NULL CHECK(chargedSeconds >= 0 AND chargedSeconds <= seconds),
				createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
				state TEXT NOT NULL CHECK(state IN ('reserved','active','closing','settled')),
				settledAt INTEGER, confirmed INTEGER
			);
			CREATE INDEX IF NOT EXISTS live_user_usage ON live_sessions(userId, createdAt);
			CREATE TABLE IF NOT EXISTS live_turns (
				id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
				turnId TEXT NOT NULL, userMessageId TEXT NOT NULL, text TEXT NOT NULL,
				state TEXT NOT NULL CHECK(state IN ('pending','done')), resultJson TEXT,
				PRIMARY KEY(id, turnId), UNIQUE(id, userMessageId)
			);
			CREATE TABLE IF NOT EXISTS live_transcripts (
				id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
				segmentId TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
				canonicalMessageId TEXT, text TEXT NOT NULL, complete INTEGER NOT NULL,
				startMs REAL NOT NULL, endMs REAL NOT NULL, PRIMARY KEY(id,segmentId)
			);`);
	} catch (error) { db.close(); throw error; }
	const findSession = db.prepare("SELECT * FROM live_sessions WHERE id = ?");
	const findTurn = db.prepare("SELECT * FROM live_turns WHERE id = ? AND turnId = ?");
	const findTranscript = db.prepare("SELECT * FROM live_transcripts WHERE id = ? AND segmentId = ?");
	const transcript = row => row ? { ...row, complete: row.complete === 1 } : null;
	const transcriptGrant = (identity, now) => {
		timestamp(now);
		const row = findSession.get(identifier(identity.id, "session id"));
		if (!row || row.userId !== identity.userId || row.clerkSessionId !== identity.clerkSessionId || row.conversationId !== identity.conversationId || !row.conversationId) throw new Error("Transcript session identity mismatch.");
		if (row.state === "reserved" || now < row.createdAt || now > row.expiresAt + CLAIM_WINDOW_MS) throw failure("live_session_expired", "Transcript drain window ended.");
		return row;
	};
	// Called only after BEGIN acquired its lock; a wait must never authorize a late write.
	const executionWindow = (id, options) => {
		if (options?.deadline === undefined) return;
		timestamp(options.deadline);
		const row = findSession.get(id), now = Date.now();
		if (now >= options.deadline || !row || row.state !== "active" || now >= row.expiresAt) throw failure("live_execution_expired", "Voice execution deadline or session ended.");
	};
	const transaction = (operation) => {
		db.exec("BEGIN IMMEDIATE");
		try { const result = operation(); db.exec("COMMIT"); return result; }
		catch (error) { db.exec("ROLLBACK"); throw error; }
	};
	const available = (userId, limits, now) => {
		const { day, month } = windows(now);
		const usage = db.prepare(`SELECT
			COALESCE(SUM(CASE WHEN createdAt >= ? THEN chargedSeconds ELSE 0 END), 0) AS daily,
			COALESCE(SUM(chargedSeconds), 0) AS monthly
			FROM live_sessions WHERE userId = ? AND createdAt >= ? AND createdAt <= ?`).get(day, userId, month, now);
		return Math.max(0, Math.min(limits.dailySeconds - usage.daily, limits.monthlySeconds - usage.monthly));
	};
	return {
		reserve({ userId, clerkSessionId, conversationId, limits, now = Date.now() }) {
			identifier(userId, "userId"); identifier(clerkSessionId, "clerkSessionId");
			// Bootstrap reserves first, then binds a newly created owned conversation.
			if (conversationId !== "") identifier(conversationId, "conversationId");
			checkedLimits(limits); timestamp(now);
			return transaction(() => {
				if (db.prepare("SELECT id FROM live_sessions WHERE userId = ? AND state IN ('reserved','active','closing') AND expiresAt > ? LIMIT 1").get(userId, now)) throw failure("live_session_active", "A live session is already reserved, active or closing.");
				const seconds = Math.floor(Math.min(limits.sessionSeconds, available(userId, limits, now), (windows(now).end - now) / 1000));
				if (seconds < MIN_SECONDS) throw failure("live_limit_reached", "There is not enough live voice allowance for another session.");
				const id = randomUUID();
				db.prepare("INSERT INTO live_sessions(id,userId,clerkSessionId,conversationId,seconds,chargedSeconds,createdAt,expiresAt,state) VALUES(?,?,?,?,?,?,?,?,'reserved')").run(id, userId, clerkSessionId, conversationId, seconds, seconds, now, now + seconds * 1000);
				return grant(findSession.get(id));
			});
		},
		get(id) { return grant(findSession.get(identifier(id, "session id"))); },
		setConversation(id, conversationId) {
			identifier(id, "session id"); identifier(conversationId, "conversationId");
			return transaction(() => {
				const row = findSession.get(id);
				if (!row) throw failure("live_session_expired", "Unknown live session.");
				if (row.state !== "reserved") throw failure("live_ticket_used", "A connected session cannot change conversations.");
				db.prepare("UPDATE live_sessions SET conversationId = ? WHERE id = ?").run(conversationId, id);
				return grant(findSession.get(id));
			});
		},
		claim(id, now = Date.now()) {
			identifier(id, "session id"); timestamp(now);
			return transaction(() => {
				const row = findSession.get(id);
				if (!row || now < row.createdAt || now >= row.expiresAt || (row.state === "reserved" && now - row.createdAt > CLAIM_WINDOW_MS)) throw failure("live_session_expired", "This live session ticket expired.");
				if (row.state !== "reserved") throw failure("live_ticket_used", "This live session ticket was already used.");
				if (!row.conversationId) throw failure("live_session_expired", "This live session has no bound conversation.");
				db.prepare("UPDATE live_sessions SET state = 'active' WHERE id = ?").run(id);
				return grant(findSession.get(id));
			});
		},
		remaining(userId, limits, now = Date.now()) {
			identifier(userId, "userId"); checkedLimits(limits); timestamp(now);
			return available(userId, limits, now);
		},
		/** Revoke further work immediately; usage stays reserved until settlement. */
		stop(id) {
			identifier(id, "session id");
			return transaction(() => {
				if (!findSession.get(id)) throw failure("live_session_expired", "Unknown live session.");
				db.prepare("UPDATE live_sessions SET state = 'closing' WHERE id = ? AND state IN ('reserved','active')").run(id);
				return grant(findSession.get(id));
			});
		},
		settle(id, seconds, confirmed, now = Date.now()) {
			identifier(id, "session id"); timestamp(now);
			if (!Number.isFinite(seconds)) throw new TypeError("Invalid settled seconds.");
			return transaction(() => {
				const row = findSession.get(id);
				if (!row) throw failure("live_session_expired", "Unknown live session.");
				if (row.state !== "settled") db.prepare("UPDATE live_sessions SET state = 'settled', chargedSeconds = ?, settledAt = ?, confirmed = ? WHERE id = ?").run(confirmed === true ? Math.max(0, Math.min(row.seconds, seconds)) : row.seconds, now, confirmed === true ? 1 : 0, id);
				return grant(findSession.get(id));
			});
		},
		claimTurn(id, turnId, userMessageId, text, options) {
			identifier(id, "session id"); identifier(turnId, "turnId"); identifier(userMessageId, "userMessageId");
			if (typeof text !== "string" || !text.trim()) throw new TypeError("Turn text is required; the caller must bound its length.");
			return transaction(() => {
				executionWindow(id, options);
				const existing = findTurn.get(id, turnId) ?? db.prepare("SELECT * FROM live_turns WHERE id = ? AND userMessageId = ?").get(id, userMessageId);
				if (existing) return { claimed: false, turn: turn(existing) };
				if (!findSession.get(id)) throw failure("live_session_expired", "Unknown live session.");
				db.prepare("INSERT INTO live_turns(id,turnId,userMessageId,text,state) VALUES(?,?,?,?,'pending')").run(id, turnId, userMessageId, text);
				return { claimed: true, turn: turn(findTurn.get(id, turnId)) };
			});
		},
		finishTurn(id, turnId, result, options) {
			identifier(id, "session id"); identifier(turnId, "turnId");
			const json = JSON.stringify(result);
			if (json === undefined) throw new TypeError("A JSON turn result is required.");
			return transaction(() => {
				executionWindow(id, options);
				const existing = findTurn.get(id, turnId);
				if (!existing) throw new Error("Claim the turn before finishing it.");
				if (existing.state === "pending") db.prepare("UPDATE live_turns SET state = 'done', resultJson = ? WHERE id = ? AND turnId = ?").run(json, id, turnId);
				return turn(findTurn.get(id, turnId));
			});
		},
		/** Speech is a bounded sidecar, never a mutation of certified Message rows. */
		saveTranscript(identity, input, now) {
			identifier(input.segmentId, "segment id");
			if (!["user", "assistant"].includes(input.role) || typeof input.text !== "string" || !input.text || input.text.length > 50_000 || typeof input.complete !== "boolean") throw new TypeError("Invalid transcript.");
			const startMs = input.startMs ?? 0, endMs = input.endMs ?? startMs;
			if (![startMs, endMs].every(value => Number.isFinite(value) && value >= 0) || endMs < startMs) throw new TypeError("Invalid transcript timing.");
			const canonicalMessageId = input.canonicalMessageId == null ? null : identifier(input.canonicalMessageId, "canonical message id");
			return transaction(() => {
				const session = transcriptGrant(identity, now ?? Date.now());
				if (endMs > session.seconds * 1000 + CLAIM_WINDOW_MS) throw new TypeError("Transcript exceeds session duration.");
				const prior = findTranscript.get(identity.id, input.segmentId);
				if (prior && (prior.role !== input.role || (prior.canonicalMessageId && canonicalMessageId && prior.canonicalMessageId !== canonicalMessageId))) throw new Error("Transcript identity mismatch.");
				if (!prior && db.prepare("SELECT COUNT(*) AS count FROM live_transcripts WHERE id = ?").get(identity.id).count >= 256) throw new Error("Too many speech segments for one session.");
				// Late partials cannot replace completed speech, but may supply its validated anchor.
				const keep = prior && ((prior.complete && !input.complete) || endMs < prior.endMs);
				db.prepare(`INSERT INTO live_transcripts(id,segmentId,role,canonicalMessageId,text,complete,startMs,endMs) VALUES(?,?,?,?,?,?,?,?)
				 ON CONFLICT(id,segmentId) DO UPDATE SET canonicalMessageId=excluded.canonicalMessageId,text=excluded.text,complete=excluded.complete,startMs=excluded.startMs,endMs=excluded.endMs`).run(identity.id, input.segmentId, input.role, prior?.canonicalMessageId ?? canonicalMessageId, keep ? prior.text : input.text, keep ? prior.complete : Number(input.complete), keep ? prior.startMs : startMs, keep ? prior.endMs : endMs);
				return transcript(findTranscript.get(identity.id, input.segmentId));
			});
		},
		getTranscript(identity, segmentId, now = Date.now()) {
			transcriptGrant(identity, now);
			return transcript(findTranscript.get(identity.id, identifier(segmentId, "segment id")));
		},
		bindTranscript(identity, segmentId, canonicalMessageId, role, now, options) {
			identifier(segmentId, "segment id"); identifier(canonicalMessageId, "canonical message id");
			return transaction(() => {
				executionWindow(identity.id, options);
				transcriptGrant(identity, options?.deadline === undefined ? now ?? Date.now() : Date.now());
				const prior = findTranscript.get(identity.id, segmentId);
				if (!prior || prior.role !== role || (prior.canonicalMessageId && prior.canonicalMessageId !== canonicalMessageId)) throw new Error("Transcript identity mismatch.");
				db.prepare("UPDATE live_transcripts SET canonicalMessageId = ? WHERE id = ? AND segmentId = ?").run(canonicalMessageId, identity.id, segmentId);
				return transcript(findTranscript.get(identity.id, segmentId));
			});
		},
		getTurn(id, turnId) { return turn(findTurn.get(identifier(id, "session id"), identifier(turnId, "turnId"))); },
		close() { db.close(); },
	};
}
