import type { ApnsJob } from "./apns";

export interface ApplePushBinding {
	id: string;
	token: string;
	userId: string;
	clerkSessionId: string | null;
}

export interface ApplePushSession {
	id: string;
	userId: string;
	clientId: string;
	status: string;
}

export interface ApplePushClient {
	id: string;
	sessionIds: readonly string[];
	lastActiveSessionId: string | null;
}

export type OwnedApplePushJob = ApnsJob & { userId: string };

/** Accept only the authenticated request's session, never a registration body field. */
export function applePushSessionId(
	authentication: { userId?: unknown; sessionId?: unknown },
	expectedUserId: string,
): string | null {
	const sid = authentication.sessionId;
	return authentication.userId === expectedUserId && typeof sid === "string" && /^sess_[A-Za-z0-9_-]{1,200}$/.test(sid)
		? sid : null;
}

/** Authorize this batch afresh; no session/client result survives into another send. */
export async function authorizeApplePushJobs(jobs: readonly OwnedApplePushJob[], dependencies: {
	loadBindings: (ids: string[]) => Promise<ApplePushBinding[]>;
	getSession: (id: string) => Promise<ApplePushSession>;
	getClient: (id: string) => Promise<ApplePushClient>;
}): Promise<{ jobs: ApnsJob[]; bindings: ApplePushBinding[]; skipped: number }> {
	const total = jobs.reduce((count, job) => count + job.recipients.length, 0);
	const refused = () => ({ jobs: [], bindings: [], skipped: total });
	if (!total) return refused();
	const ids = [...new Set(jobs.flatMap((job) => job.recipients.map((recipient) => recipient.tokenId)))];
	let first: Map<string, ApplePushBinding>;
	try {
		first = new Map((await dependencies.loadBindings(ids)).map((row) => [row.id, row]));
	} catch { return refused(); }
	const sessions = new Map<string, Promise<ApplePushSession>>();
	const clients = new Map<string, Promise<ApplePushClient>>();
	const candidates = jobs.flatMap((job, jobIndex) => job.recipients.map((recipient) => ({ job, jobIndex, recipient })));
	const allowed = new Array<boolean>(candidates.length).fill(false);
	let next = 0;
	const worker = async () => {
		while (next < candidates.length) {
			const index = next++;
			const { job, recipient } = candidates[index];
			const row = first.get(recipient.tokenId);
			if (!row || row.userId !== job.userId || !row.clerkSessionId ||
				row.token !== `apns:${recipient.environment}:${recipient.deviceToken}`) continue;
			try {
				const sid = row.clerkSessionId;
				if (!sessions.has(sid)) sessions.set(sid, dependencies.getSession(sid));
				const session = await sessions.get(sid)!;
				if (session.id !== sid || session.userId !== job.userId || session.status !== "active" || !session.clientId) continue;
				if (!clients.has(session.clientId)) clients.set(session.clientId, dependencies.getClient(session.clientId));
				const client = await clients.get(session.clientId)!;
				allowed[index] = client.id === session.clientId && client.lastActiveSessionId === sid && client.sessionIds.includes(sid);
			} catch { /* Unknown session state is never permission to send. */ }
		}
	};
	await Promise.all(Array.from({ length: Math.min(10, candidates.length) }, () => worker()));
	// A token can move accounts while Clerk is being read. Recheck ownership,
	// session and token after those awaits rather than authorizing a stale row.
	let current: Map<string, ApplePushBinding>;
	try {
		current = new Map((await dependencies.loadBindings(ids)).map((row) => [row.id, row]));
	} catch { return refused(); }
	const approved = jobs.map((job) => ({ message: job.message, recipients: [] as ApnsJob["recipients"] }));
	const bindings = new Map<string, ApplePushBinding>();
	let count = 0;
	for (const [index, { job, jobIndex, recipient }] of candidates.entries()) {
		const before = first.get(recipient.tokenId);
		const row = current.get(recipient.tokenId);
		if (!allowed[index] || !before || !row || row.userId !== job.userId ||
			row.clerkSessionId !== before.clerkSessionId || row.token !== before.token) continue;
		approved[jobIndex].recipients.push(recipient);
		bindings.set(row.id, row);
		count += 1;
	}
	return { jobs: approved.filter((job) => job.recipients.length > 0), bindings: [...bindings.values()], skipped: total - count };
}
