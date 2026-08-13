import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { isProviderId, PROVIDERS, type ProviderId } from "@/lib/ai/models";
import { DB_PROVIDER, isServerCredentialUser } from "@/lib/ai/provider";

export const maxDuration = 30;

/**
 * Validates a key against the provider's free models-list endpoint — proves
 * the key authenticates without spending tokens.
 */
async function validateKey(provider: ProviderId, apiKey: string): Promise<boolean> {
	const requests: Record<ProviderId, { url: string; headers: Record<string, string> }> = {
		openai: {
			url: "https://api.openai.com/v1/models",
			headers: { Authorization: `Bearer ${apiKey}` },
		},
		anthropic: {
			url: "https://api.anthropic.com/v1/models",
			headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
		},
		moonshot: {
			url: "https://api.moonshot.ai/v1/models",
			headers: { Authorization: `Bearer ${apiKey}` },
		},
	};
	const { url, headers } = requests[provider];
	const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
	return response.ok;
}

export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const credentials = await prisma.providerCredential.findMany({
			where: { userId },
			select: { provider: true, last4: true, validatedAt: true, updatedAt: true },
		});
		const byProvider = new Map(credentials.map((credential) => [credential.provider, credential]));

		return NextResponse.json({
			serverCredentials: isServerCredentialUser(userId),
			providers: PROVIDERS.map((provider) => {
				const credential = byProvider.get(DB_PROVIDER[provider.id]);
				return {
					id: provider.id,
					label: provider.label,
					keyUrl: provider.keyUrl,
					connected: Boolean(credential),
					last4: credential?.last4 ?? null,
					validatedAt: credential?.validatedAt?.toISOString() ?? null,
				};
			}),
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/providers] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const body: unknown = await req.json();
		const { provider, apiKey } =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>)
				: {};

		if (!isProviderId(provider) || typeof apiKey !== "string" || apiKey.trim().length < 8) {
			return NextResponse.json({ error: "A provider and API key are required." }, { status: 400 });
		}
		const trimmedKey = apiKey.trim();

		let valid = false;
		try {
			valid = await validateKey(provider, trimmedKey);
		} catch {
			return NextResponse.json(
				{ error: "Could not reach the provider to validate the key. Try again." },
				{ status: 502 },
			);
		}
		if (!valid) {
			return NextResponse.json({ error: "That API key was rejected by the provider." }, { status: 400 });
		}

		const record = {
			encryptedKey: encryptSecret(trimmedKey),
			last4: trimmedKey.slice(-4),
			validatedAt: new Date(),
		};
		await prisma.providerCredential.upsert({
			where: { userId_provider: { userId, provider: DB_PROVIDER[provider] } },
			update: record,
			create: { userId, provider: DB_PROVIDER[provider], ...record },
		});

		return NextResponse.json({ ok: true, provider, last4: record.last4 });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/providers] POST failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const body: unknown = await req.json();
		const provider =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>).provider
				: undefined;
		if (!isProviderId(provider)) {
			return NextResponse.json({ error: "A provider is required." }, { status: 400 });
		}

		await prisma.providerCredential.deleteMany({
			where: { userId, provider: DB_PROVIDER[provider] },
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/providers] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
