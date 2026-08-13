"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Lock, Sparkles } from "lucide-react";
import {
	readEffortPref,
	readModelPref,
	writeEffortPref,
	writeModelPref,
} from "@/lib/preferences";

interface PickerModel {
	id: string;
	label: string;
	provider: string;
	supportsAttachments: boolean;
	efforts: string[];
	available: boolean;
}

interface PickerProvider {
	id: string;
	label: string;
	available: boolean;
}

interface ModelsResponse {
	providers?: PickerProvider[];
	models: PickerModel[];
	defaults: { modelId: string; effort: string | null };
}

const PROVIDER_LABELS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	moonshot: "Moonshot",
};

const EFFORT_OPTIONS = [
	{ id: null, label: "Auto" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
] as const;

/**
 * ChatGPT-style model + reasoning-effort picker on the chat input, grouped by
 * provider: tap a provider to see every model its API key unlocks (the server
 * lists them live from the provider). Providers without a key are locked and
 * point at Settings → AI Providers. Picks are stored locally and sent with
 * each request; the server persists them as the account default.
 */
const ModelPicker: React.FC = () => {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<ModelsResponse | null>(null);
	const [modelId, setModelId] = useState<string | null>(null);
	const [effort, setEffort] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await fetch("/api/ai/models");
				if (!response.ok) return;
				const body: ModelsResponse = await response.json();
				if (cancelled) return;
				setData(body);
				const localModel = readModelPref();
				const validLocal = body.models.find((model) => model.id === localModel && model.available);
				setModelId(validLocal?.id ?? body.defaults.modelId);
				setEffort(readEffortPref() ?? body.defaults.effort);
			} catch {
				// Picker is an enhancement; chat still works on the server default.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!open) return;
		const close = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [open]);

	const selected = useMemo(
		() => data?.models.find((model) => model.id === modelId) ?? null,
		[data, modelId],
	);

	const providers = useMemo<PickerProvider[]>(() => {
		if (!data) return [];
		if (data.providers?.length) return data.providers;
		// Older payload shape: derive the provider rows from the flat list.
		const seen = new Map<string, PickerProvider>();
		for (const model of data.models) {
			if (!seen.has(model.provider)) {
				seen.set(model.provider, {
					id: model.provider,
					label: PROVIDER_LABELS[model.provider] ?? model.provider,
					available: model.available,
				});
			}
		}
		return [...seen.values()];
	}, [data]);

	// First open lands on the provider of the current model.
	useEffect(() => {
		if (open) setExpanded(selected?.provider ?? providers[0]?.id ?? null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	if (!data) return null;

	const pickModel = (model: PickerModel) => {
		if (!model.available) return;
		setModelId(model.id);
		writeModelPref(model.id);
		setOpen(false);
	};

	const pickEffort = (id: string | null) => {
		setEffort(id);
		writeEffortPref(id);
	};

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label="Choose AI model"
				className="flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-amber-700 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-amber-400"
			>
				<Sparkles className="h-3.5 w-3.5" />
				<span className="hidden max-w-[110px] truncate sm:block">
					{selected?.label ?? "Model"}
				</span>
				<ChevronDown className="h-3 w-3" />
			</button>

			{open && (
				<div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg dark:border-white/[0.08] dark:bg-neutral-900">
					<div className="max-h-80 overflow-y-auto custom-scrollbar py-1">
						{providers.map((provider) => {
							const providerModels = data.models.filter(
								(model) => model.provider === provider.id,
							);
							if (providerModels.length === 0) return null;
							const isExpanded = expanded === provider.id;
							return (
								<div key={provider.id}>
									<button
										type="button"
										aria-expanded={isExpanded}
										onClick={() =>
											setExpanded((current) => (current === provider.id ? null : provider.id))
										}
										className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
									>
										{isExpanded ? (
											<ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
										) : (
											<ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
										)}
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-semibold text-neutral-800 dark:text-neutral-200">
												{provider.label}
											</span>
											<span className="block text-xs text-neutral-400 dark:text-neutral-500">
												{provider.available
													? `${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`
													: "Add your API key in Settings"}
											</span>
										</span>
										{!provider.available && (
											<Lock className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
										)}
									</button>
									{isExpanded &&
										providerModels.map((model) => {
											const active = model.id === modelId;
											return (
												<button
													type="button"
													key={model.id}
													role="option"
													aria-selected={active}
													disabled={!model.available}
													onClick={() => pickModel(model)}
													className={`flex w-full items-center gap-2 py-2 pl-11 pr-4 text-left transition-colors ${
														model.available
															? "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
															: "opacity-50"
													}`}
												>
													<span
														className={`min-w-0 flex-1 truncate text-sm ${
															active
																? "font-semibold text-amber-700 dark:text-amber-400"
																: "text-neutral-700 dark:text-neutral-300"
														}`}
													>
														{model.label}
													</span>
													{active && (
														<Check className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
													)}
												</button>
											);
										})}
								</div>
							);
						})}
					</div>
					<div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
						<p className="mb-2 text-[11px] font-bold tracking-[0.12em] text-neutral-400 dark:text-neutral-500">
							REASONING
						</p>
						<div className="grid grid-cols-4 gap-1">
							{EFFORT_OPTIONS.map((option) => {
								const active = effort === option.id || (!effort && option.id === null);
								return (
									<button
										type="button"
										key={option.label}
										aria-pressed={active}
										onClick={() => pickEffort(option.id)}
										className={`rounded-lg border px-1 py-1.5 text-[11px] font-bold transition-colors ${
											active
												? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400"
												: "border-black/[0.1] bg-black/[0.03] text-neutral-500 hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
										}`}
									>
										{option.label}
									</button>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default ModelPicker;
