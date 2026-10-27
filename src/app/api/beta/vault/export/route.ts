import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { exportVault } from "@/lib/beta/vault/export";
import { vaultFailure } from "@/lib/beta/vault/http";
import { vaultMarkdown } from "@/lib/beta/vault/vault-rules";

/** GET /api/beta/vault/export?format=md|json: the whole vault as one download. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
		const data = await exportVault(gate.userId);
		const name = `sureword-vault-${data.exportedAt.slice(0, 10)}.${format}`;
		const body = format === "json" ? `${JSON.stringify(data, null, 2)}\n` : vaultMarkdown(data);
		return new Response(body, {
			headers: {
				...BETA_PRIVATE_HEADERS,
				"Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
				"Content-Disposition": `attachment; filename="${name}"`,
			},
		});
	} catch (error) {
		return vaultFailure(error, "/export", "Your vault could not be exported just now.");
	}
}
