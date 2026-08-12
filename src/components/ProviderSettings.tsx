"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";

interface ProviderStatus {
	id: string;
	label: string;
	keyUrl: string;
	connected: boolean;
	last4: string | null;
	validatedAt: string | null;
}

interface ProvidersResponse {
	serverCredentials: boolean;
	providers: ProviderStatus[];
}

/**
 * Settings → AI Providers: add, replace, or remove per-provider API keys.
 * Adding a key unlocks that provider's models in the chat model picker. Keys
 * are validated against the provider before being stored (encrypted) and are
 * never shown again — only their last four characters.
 */
const ProviderSettings: React.FC = () => {
	const [data, setData] = useState<ProvidersResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [keyInput, setKeyInput] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoadFailed(false);
		try {
			const response = await fetch("/api/providers");
			if (!response.ok) throw new Error();
			setData(await response.json());
		} catch {
			setLoadFailed(true);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const saveKey = async (provider: string) => {
		if (pending || keyInput.trim().length === 0) return;
		setPending(true);
		setError(null);
		try {
			const response = await fetch("/api/providers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider, apiKey: keyInput.trim() }),
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? "Could not save the key.");
			setEditing(null);
			setKeyInput("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the key.");
		} finally {
			setPending(false);
		}
	};

	const removeKey = async (provider: string) => {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			const response = await fetch("/api/providers", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider }),
			});
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? "Could not remove the key.");
			}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not remove the key.");
		} finally {
			setPending(false);
		}
	};

	if (loadFailed) {
		return (
			<div className="glass-card gradient-border rounded-2xl p-4 flex items-center justify-between gap-3">
				<p className="text-xs text-neutral-400 dark:text-neutral-500">
					Couldn&apos;t load provider settings.
				</p>
				<button
					type="button"
					onClick={() => void load()}
					className="text-xs font-bold text-amber-600 dark:text-amber-400"
				>
					Retry
				</button>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="glass-card gradient-border rounded-2xl p-4 flex items-center justify-center">
				<Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
			</div>
		);
	}

	return (
		<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
			<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
				Bring your own API keys to unlock each provider&apos;s models in the chat
				model picker. Keys are validated, stored encrypted, and used only for
				your own conversations.
			</p>
			{data.serverCredentials && (
				<p className="text-xs text-amber-600 dark:text-amber-400">
					Your account also has access to SureWord&apos;s built-in keys; adding
					your own overrides them per provider.
				</p>
			)}
			{data.providers.map((provider) => (
				<div
					key={provider.id}
					className="rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] p-3.5 flex flex-col gap-2.5"
				>
					<div className="flex items-center gap-3">
						<span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] text-amber-600 dark:text-amber-400">
							<KeyRound className="h-4 w-4" />
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
								{provider.label}
							</p>
							<p className="flex items-center gap-1 text-[13px] text-neutral-400 dark:text-neutral-500">
								{provider.connected ? (
									<>
										<Check className="h-3 w-3 text-emerald-500" />
										Key ending in {provider.last4}
									</>
								) : (
									"Not connected"
								)}
							</p>
						</div>
						{editing !== provider.id && (
							<div className="flex items-center gap-1">
								<button
									type="button"
									disabled={pending}
									onClick={() => {
										setEditing(provider.id);
										setKeyInput("");
										setError(null);
									}}
									className="rounded-lg border border-black/[0.1] dark:border-white/[0.08] px-3 py-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
								>
									{provider.connected ? "Replace" : "Add key"}
								</button>
								{provider.connected && (
									<button
										type="button"
										disabled={pending}
										aria-label={`Remove ${provider.label} key`}
										onClick={() => void removeKey(provider.id)}
										className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:text-red-500 transition-colors"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								)}
							</div>
						)}
					</div>
					{editing === provider.id && (
						<div className="flex flex-col gap-2">
							<input
								type="password"
								value={keyInput}
								onChange={(event) => setKeyInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void saveKey(provider.id);
								}}
								placeholder={`Paste your ${provider.label} API key`}
								autoFocus
								className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 outline-none focus:border-amber-500/50"
							/>
							<div className="flex items-center gap-2">
								<button
									type="button"
									disabled={pending || keyInput.trim().length === 0}
									onClick={() => void saveKey(provider.id)}
									className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 dark:border-amber-400/30 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 disabled:opacity-40 transition-colors"
								>
									{pending && <Loader2 className="h-3 w-3 animate-spin" />}
									Validate & save
								</button>
								<button
									type="button"
									disabled={pending}
									onClick={() => {
										setEditing(null);
										setKeyInput("");
										setError(null);
									}}
									className="rounded-lg px-3 py-1.5 text-xs font-bold text-neutral-500 dark:text-neutral-400 transition-colors"
								>
									Cancel
								</button>
								<a
									href={provider.keyUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="ml-auto flex items-center gap-1 text-xs font-semibold text-neutral-400 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
								>
									Get a key
									<ExternalLink className="h-3 w-3" />
								</a>
							</div>
						</div>
					)}
				</div>
			))}
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
		</div>
	);
};

export default ProviderSettings;
