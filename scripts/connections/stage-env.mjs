import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// This maintenance command stages credentials only. It never changes rollout
// flags, grants provider access, changes database URLs or deploys the app.
const project = "prj_XSWeGTKvor3mAnKQXm3NjCAKwpVJ";
const scope = "spragginsdesigns-projects";
const names = {
	google: ["CONNECTIONS_GOOGLE_CLIENT_ID", "CONNECTIONS_GOOGLE_CLIENT_SECRET"],
	ticktick: ["CONNECTIONS_TICKTICK_CLIENT_ID", "CONNECTIONS_TICKTICK_CLIENT_SECRET"],
	todoist: ["CONNECTIONS_TODOIST_CLIENT_ID", "CONNECTIONS_TODOIST_CLIENT_SECRET"],
	notion: ["CONNECTIONS_NOTION_CLIENT_ID", "CONNECTIONS_NOTION_CLIENT_SECRET"],
	microsoft: ["CONNECTIONS_MICROSOFT_CLIENT_ID", "CONNECTIONS_MICROSOFT_CLIENT_SECRET"],
	gmail: ["CONNECTIONS_GMAIL_CLIENT_ID", "CONNECTIONS_GMAIL_CLIENT_SECRET"],
	youversion: ["CONNECTIONS_YOUVERSION_APP_KEY"],
};
const providers = process.argv.filter(value => value.startsWith("--provider=")).map(value => value.slice(11));
if (!providers.length || providers.some(provider => !Object.hasOwn(names, provider))) throw new Error("Pass a supported --provider= value for each registered provider.");
const keys = [...new Set(providers.flatMap(provider => names[provider]))];
const cli = resolve(process.env.APPDATA ?? "", "npm/node_modules/vercel/dist/vc.js");
if (!existsSync(cli)) throw new Error("The verified Vercel CLI entrypoint is unavailable.");
const linked = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
if (linked.projectId !== project || linked.projectName !== "bible-ai-explorer") throw new Error("The working directory is not linked to the SureWord project.");
const environment = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
	const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (match && keys.includes(match[1])) {
		try { environment[match[1]] = JSON.parse(match[2]); } catch { environment[match[1]] = match[2]; }
	}
}
if (keys.some(key => typeof environment[key] !== "string" || !environment[key] || /[\r\n]/.test(environment[key]))) throw new Error("A requested credential is missing or malformed. Values are withheld.");
function vercel(args, input) {
	const result = spawnSync(process.execPath, [cli, ...args, "--scope", scope, "--project", project], {
		input, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"], timeout: 45000,
	});
	if (result.status !== 0) throw new Error("Vercel configuration failed. Values and raw CLI output are withheld; inspect project access before retrying.");
	return result.stdout;
}
function metadata() {
	const data = JSON.parse(vercel(["env", "ls", "--environment", "production", "--json"]));
	const rows = Array.isArray(data) ? data : data.envs ?? data.environmentVariables;
	if (!Array.isArray(rows)) throw new Error("The environment metadata shape was not recognized; no values are shown.");
	return rows;
}
try {
	const before = metadata();
	const present = new Set(before.map(entry => entry.key));
	if (!process.argv.includes("--apply")) {
		console.log(JSON.stringify({ mode: "plan", projectId: project, target: "production", variables: keys.map(key => ({ key, operation: present.has(key) ? "preserve-existing" : "add-secret" })), activationChanged: false }));
	} else {
		const added = [];
		for (const key of keys) {
			// A resumed run must not overwrite credentials already present remotely.
			if (present.has(key)) continue;
			vercel(["env", "add", key, "--environment", "production", "--type", "secret", "--yes"], environment[key]);
			added.push(key);
			console.log(JSON.stringify({ key, staged: true, valueOmitted: true }));
		}
		const verified = metadata().filter(entry => keys.includes(entry.key)).map(entry => ({ key: entry.key, type: entry.visibility ?? entry.type, target: entry.target }));
		if (verified.length !== keys.length || verified.some(entry => !entry.target?.includes("production") || !["secret", "sensitive"].includes(entry.type))) throw new Error("The requested credentials are not all production Secrets. Existing values were not overwritten.");
		const evidence = { verifiedAt: new Date().toISOString(), projectId: project, target: "production", added, preserved: keys.filter(key => !added.includes(key)), variables: verified, activationChanged: false, deployed: false };
		mkdirSync("artifacts/connections", { recursive: true });
		writeFileSync("artifacts/connections/production-env-stage-proof.json", JSON.stringify(evidence, null, 2));
		console.log(JSON.stringify(evidence));
	}
} catch (error) {
	console.error(JSON.stringify({ status: "failed", reason: error.message }));
	process.exitCode = 1;
}
