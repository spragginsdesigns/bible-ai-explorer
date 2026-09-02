"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
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

/** The single model an account without its own API key is served on. */
interface HouseMode {
	modelId: string;
	label: string;
	effort: string;
	note: string;
}

interface ModelsResponse {
	access: "house" | "keys";
	/** Unlocked providers only; absent from a server still on the older payload. */
	providers?: PickerProvider[];
	models: PickerModel[];
	defaults: { modelId: string; effort: string | null };
	house: HouseMode | null;
}

const EFFORT_OPTIONS = [
	{ id: null, label: "Auto" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
] as const;

/**
 * ChatGPT-style model + reasoning-effort picker on the chat input.
 *
 * Two shapes, decided by the server:
 *
 * - "house": the account has no API key of its own and runs on SureWord's
 *   included model at a pinned reasoning effort. There is nothing to choose,
 *   so the popover shows that one model, says so, and links to Settings.
 *   Locked providers are never listed - an account that cannot use a provider
 *   has no reason to see its name.
 * - "keys": grouped by provider, tap a provider to see every model its API key
 *   unlocks (the server lists them live from the provider). The server sends
 *   only unlocked providers.
 *
 * Picks are stored locally and sent with each request; the server persists
 * them as the account default.
 */
interface ModelPickerProps {
	/**
	 * Which way the popover opens. "above" suits the composer docked at the
	 * viewport edge; "below" is for a composer sitting inside a scroll
	 * container, where an upward popover is clipped by the container.
	 */
	placement?: "above" | "below";
}

const ModelPicker: React.FC<ModelPickerProps> = ({ placement = "above" }) => {
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
				const houseOnLoad = body.access === "house" ? body.house : null;
				if (houseOnLoad) {
					// House mode ignores any earlier pick. useChat reads these prefs
					// from localStorage on every send, so a stale model id left over
					// from a key the account no longer has would be what the request
					// carried while the chip claimed otherwise. Overwrite both so the
					// chip and the request say the same thing.
					setModelId(houseOnLoad.modelId);
					setEffort(houseOnLoad.effort);
					writeModelPref(houseOnLoad.modelId);
					writeEffortPref(houseOnLoad.effort);
					return;
				}
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

	const house = useMemo<HouseMode | null>(
		() => (data?.access === "house" ? data.house ?? null : null),
		[data],
	);

	// The server sends unlocked providers only; filter anyway so a stale or
	// hand-rolled payload can never put a provider the account cannot use back
	// on screen. Optional chaining because a deploy mid-rollout can still answer
	// with the older payload that had no providers array at all.
	const providers = useMemo<PickerProvider[]>(
		() => data?.providers?.filter((provider) => provider.available) ?? [],
		[data],
	);

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
					{house?.label ?? selected?.label ?? "Model"}
				</span>
				<ChevronDown className="h-3 w-3" />
			</button>

			{open && (
				<div
					className={`absolute left-0 z-30 w-72 overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg dark:border-white/[0.08] dark:bg-neutral-900 ${
						placement === "below" ? "top-full mt-2" : "bottom-full mb-2"
					}`}
				>
					{house ? (
						<>
							<div className="py-1" role="listbox" aria-label="AI model">
								{/* Nothing to choose, so this row is text rather than a
								    control: one model, already in use. */}
								<div
									role="option"
									aria-selected
									className="flex items-center gap-2 px-4 py-2.5"
								>
									<span className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-700 dark:text-amber-400">
										{house.label}
									</span>
									<Check className="h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
								</div>
							</div>
							<div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
								<p className="text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
									{house.note}
								</p>
								<Link
									href="/settings"
									onClick={() => setOpen(false)}
									className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
								>
									Add an API key
									<ChevronRight className="h-3 w-3" />
								</Link>
							</div>
						</>
					) : (
						<>
							<div className="max-h-80 overflow-y-auto custom-scrollbar py-1">
								{providers.map((provider) => {
									const providerModels = data.models.filter(
										(model) => model.provider === provider.id && model.available,
									);
									if (providerModels.length === 0) return null;
									const isExpanded = expanded === provider.id;
									return (
										<div key={provider.id}>
											<button
												type="button"
												aria-expanded={isExpanded}
												onClick={() =>
													setExpanded((current) =>
														current === provider.id ? null : provider.id,
													)
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
														{`${providerModels.length} model${providerModels.length === 1 ? "" : "s"}`}
													</span>
												</span>
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
															onClick={() => pickModel(model)}
															className="flex w-full items-center gap-2 py-2 pl-11 pr-4 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
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
								<p className="mb-2 text-metadata font-bold tracking-[0.12em] text-neutral-400 dark:text-neutral-500">
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
												className={`rounded-lg border px-1 py-1.5 text-metadata font-bold transition-colors ${
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
						</>
					)}
				</div>
			)}
		</div>
	);
};

export default ModelPicker;
