import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

// Official RFC 7591 registration, documented at https://developer.todoist.com/api/v1/.
// Registration creates an app, not a user grant. Public rollout stays disabled.
const metadata = {
	client_name: "SureWord",
	client_uri: "https://sureword.app",
	logo_uri: "https://sureword.app/icon-512.png",
	redirect_uris: ["https://sureword.app/api/connections/oauth/callback"],
	scope: "data:read task:add",
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
	token_endpoint_auth_method: "client_secret_post",
};
const directory = "artifacts/connections";
const receipt = `${directory}/todoist-registration-private.json`;
const marker = `${directory}/todoist-registration-attempt.json`;
const envPath = ".env.local";

try {
	if (!process.argv.includes("--apply")) {
		console.log(JSON.stringify({ mode: "plan", endpoint: "https://api.todoist.com/oauth/register", metadata, grantsUserAccess: false, activationChanged: false }));
	} else {
		mkdirSync(directory, { recursive: true });
		let registration;
		if (existsSync(receipt)) {
			registration = JSON.parse(readFileSync(receipt, "utf8"));
		} else {
			if (existsSync(marker)) throw new Error("A registration was already attempted. Resolve its outcome before creating another app.");
			if (/^CONNECTIONS_TODOIST_CLIENT_(ID|SECRET)=/m.test(readFileSync(envPath, "utf8"))) throw new Error("Todoist credentials already exist. Preserve the registered app.");
			// Persist the attempt before sending: a timeout must never create duplicate apps.
			writeFileSync(marker, JSON.stringify({ attemptedAt: new Date().toISOString(), metadata }), { flag: "wx", mode: 0o600 });
			const response = await fetch("https://api.todoist.com/oauth/register", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify(metadata), signal: AbortSignal.timeout(30000), redirect: "error",
			});
			const body = await response.text();
			if (response.status !== 201) throw new Error(`Todoist registration returned HTTP ${response.status}. Raw response withheld; no automatic retry.`);
			// Save the one-time credential response before validation or environment editing.
			writeFileSync(receipt, body, { flag: "wx", mode: 0o600 });
			registration = JSON.parse(body);
		}
		if (typeof registration.client_id !== "string" || !registration.client_id.startsWith("tdd_") ||
			typeof registration.client_secret !== "string" || !registration.client_secret ||
			registration.client_name !== metadata.client_name ||
			registration.token_endpoint_auth_method !== metadata.token_endpoint_auth_method ||
			JSON.stringify(registration.redirect_uris) !== JSON.stringify(metadata.redirect_uris) ||
			registration.scope?.split(" ").sort().join(" ") !== metadata.scope.split(" ").sort().join(" ")) {
			throw new Error("The saved registration does not match the requested SureWord metadata. Review privately before staging.");
		}
		let env = readFileSync(envPath, "utf8");
		for (const [key, value] of Object.entries({ CONNECTIONS_TODOIST_CLIENT_ID: registration.client_id, CONNECTIONS_TODOIST_CLIENT_SECRET: registration.client_secret })) {
			const existing = env.split(/\r?\n/).find(line => line.startsWith(`${key}=`));
			if (existing) {
				if (existing !== `${key}=${JSON.stringify(value)}`) throw new Error("Existing Todoist credential differs. Refusing to overwrite it.");
			} else env = `${env.trimEnd()}\n${key}=${JSON.stringify(value)}\n`;
		}
		writeFileSync(`${envPath}.connections-tmp`, env, { mode: 0o600 });
		renameSync(`${envPath}.connections-tmp`, envPath);
		const proof = { registeredAt: new Date().toISOString(), provider: "todoist", metadata, credentialsSaved: true, valuesOmitted: true, userGrantVerified: false, activationChanged: false };
		writeFileSync(`${directory}/todoist-registration-proof.json`, JSON.stringify(proof, null, 2));
		console.log(JSON.stringify(proof));
	}
} catch (error) {
	console.error(JSON.stringify({ status: "failed", reason: error instanceof Error ? error.message : "Registration failed; response withheld." }));
	process.exitCode = 1;
}
