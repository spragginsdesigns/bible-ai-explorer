"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Search, Sparkles } from "lucide-react";
import {
	readEffortPref,
	readModePref,
	readModelPref,
	readSpeedPref,
	readVerbosityPref,
	writeEffortPref,
	writeModePref,
	writeModelPref,
	writeSpeedPref,
	writeVerbosityPref,
} from "@/lib/preferences";
import {
	activeChipId,
	AUTO_EFFORT_SENTINEL,
	capabilityPills,
	modelMeta,
	optionSections,
	searchModels,
	shouldShowSearch,
	summaryLabel,
	SUMMARY_SEPARATOR,
	type OptionSectionKey,
	type PickerModel,
	type StoredRunOptions,
} from "./modelPickerRules";

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
	/**
	 * The account defaults. Everything past `modelId` is optional: a server
	 * still on the older payload sends only `modelId` and `effort`.
	 */
	defaults: {
		modelId: string;
		effort: string | null;
		speed?: string | null;
		verbosity?: string | null;
		mode?: string | null;
	};
	house: HouseMode | null;
}

/** Popover geometry. Wider than the old 288 to fit meta lines and chip rows. */
const MENU_WIDTH = 360;
/** Breathing room kept between the menu and every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** The menu never grows past this, however tall the viewport is. */
const MAX_MENU_HEIGHT = 560;

/**
 * Where the popover is pinned, in viewport coordinates. Exactly one of
 * `top` / `bottom` is set: anchoring by `bottom` opens the menu upward
 * without having to know its rendered height first. `width` is measured
 * rather than fixed so a 360px-wide phone viewport cannot be overflowed
 * horizontally by a 360px menu plus its margins.
 */
interface MenuPosition {
	left: number;
	top: number | null;
	bottom: number | null;
	maxHeight: number;
	width: number;
}

/**
 * ChatGPT-style model + run-options picker on the chat input.
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
 *   only unlocked providers. Below the list sit the option rows the selected
 *   model actually supports: REASONING, SPEED, LENGTH, MODE.
 *
 * Picks are stored locally and sent with each request; the server persists
 * them as the account default.
 */
interface ModelPickerProps {
	/**
	 * Preferred side. The menu renders in a portal and flips to the other
	 * side when the preferred one cannot fit it, so this is a hint rather
	 * than a promise.
	 */
	placement?: "above" | "below";
}

/**
 * Copies the account default into local storage the first time this browser
 * sees it, for one run option.
 *
 * Without this, a device that has never touched the picker holds null for
 * every option while the chip row draws the server's default, so the chip and
 * the request disagree; and once the request stops carrying the value, a
 * server that reads absence as a choice can clear a default set elsewhere.
 * A pref that already exists is never overwritten.
 */
function seedPref(
	stored: string | null,
	serverDefault: string | null | undefined,
	write: (value: string | null) => void,
): string | null {
	if (stored !== null) return stored;
	if (typeof serverDefault === "string" && serverDefault) {
		write(serverDefault);
		return serverDefault;
	}
	return null;
}

const CHIP_BASE =
	"flex-1 rounded-lg border px-1.5 py-1.5 text-center text-metadata font-bold leading-none transition-colors";
const CHIP_ACTIVE =
	"border-amber-500/40 bg-amber-500/10 text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400";
const CHIP_IDLE =
	"border-black/[0.1] bg-black/[0.03] text-neutral-500 hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:bg-white/[0.06]";

const ModelPicker: React.FC<ModelPickerProps> = ({ placement = "above" }) => {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<ModelsResponse | null>(null);
	const [modelId, setModelId] = useState<string | null>(null);
	const [effort, setEffort] = useState<string | null>(null);
	const [speed, setSpeed] = useState<string | null>(null);
	const [verbosity, setVerbosity] = useState<string | null>(null);
	const [mode, setMode] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const [query, setQuery] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	// The menu is portalled out of the trigger's subtree, so focus has to be
	// moved into it by hand and handed back to the trigger on close.
	const menuId = `model-picker-${useId()}`;
	const focusedOnOpenRef = useRef(false);

	const closeMenu = useCallback(() => {
		setOpen(false);
		setQuery("");
		triggerRef.current?.focus();
	}, []);

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
					// carried while the chip claimed otherwise. Overwrite all of them
					// so the chip and the request say the same thing.
					setModelId(houseOnLoad.modelId);
					setEffort(houseOnLoad.effort);
					setSpeed(null);
					setVerbosity(null);
					setMode(null);
					writeModelPref(houseOnLoad.modelId);
					writeEffortPref(houseOnLoad.effort);
					writeSpeedPref(null);
					writeVerbosityPref(null);
					writeModePref(null);
					return;
				}
				const localModel = readModelPref();
				const validLocal = body.models.find((model) => model.id === localModel && model.available);
				setModelId(validLocal?.id ?? body.defaults.modelId);
				setEffort(seedPref(readEffortPref(), body.defaults.effort, writeEffortPref));
				setSpeed(seedPref(readSpeedPref(), body.defaults.speed, writeSpeedPref));
				setVerbosity(
					seedPref(readVerbosityPref(), body.defaults.verbosity, writeVerbosityPref),
				);
				setMode(seedPref(readModePref(), body.defaults.mode, writeModePref));
			} catch {
				// Picker is an enhancement; chat still works on the server default.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	/**
	 * Pins the menu in viewport coordinates. The composer can sit inside a
	 * scroll container (the welcome screen), so an absolutely positioned menu
	 * was clipped by that container and the reasoning control ended up
	 * off-screen. A fixed, portalled menu has no clipping ancestor; all it
	 * needs is collision handling of its own.
	 */
	const measure = useCallback((): MenuPosition | null => {
		const trigger = triggerRef.current;
		if (!trigger) return null;
		const rect = trigger.getBoundingClientRect();
		const spaceAbove = rect.top - VIEWPORT_MARGIN * 2;
		const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN * 2;
		const preferAbove = placement === "above";
		const preferredSpace = preferAbove ? spaceAbove : spaceBelow;
		const otherSpace = preferAbove ? spaceBelow : spaceAbove;
		// Keep the preferred side while it can show the whole menu; once it
		// cannot, take whichever side is roomier. With four option sections the
		// menu wants its full height, and a merely "not cramped" side (the old
		// 260px floor) squeezed the list and the chips into two scrolling
		// slivers on the welcome screen while the other side sat empty.
		const useAbove =
			preferredSpace >= MAX_MENU_HEIGHT || preferredSpace >= otherSpace
				? preferAbove
				: !preferAbove;
		const available = useAbove ? spaceAbove : spaceBelow;
		// A 360px menu on a 360px viewport would push the page sideways, so the
		// width shrinks to whatever is left after both margins.
		const width = Math.max(
			240,
			Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
		);
		return {
			left: Math.round(
				Math.max(
					VIEWPORT_MARGIN,
					Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
				),
			),
			top: useAbove ? null : Math.round(rect.bottom + VIEWPORT_MARGIN),
			bottom: useAbove
				? Math.round(window.innerHeight - rect.top + VIEWPORT_MARGIN)
				: null,
			maxHeight: Math.round(Math.max(160, Math.min(available, MAX_MENU_HEIGHT))),
			width: Math.round(width),
		};
	}, [placement]);

	useEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		setPosition(measure());
		const reposition = () => setPosition(measure());
		const close = (event: MouseEvent) => {
			const target = event.target as Node;
			if (containerRef.current?.contains(target)) return;
			if (menuRef.current?.contains(target)) return;
			closeMenu();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeMenu();
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", reposition);
		// Capture phase so scrolling any ancestor container repositions too.
		window.addEventListener("scroll", reposition, true);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("resize", reposition);
			window.removeEventListener("scroll", reposition, true);
		};
	}, [open, measure, closeMenu]);

	// Focus once, on the render where the menu first has a position (and so
	// actually exists in the DOM); repositioning on scroll must not re-focus.
	// The search field wins when it is on screen, so typing filters straight
	// away instead of scrolling the list.
	useEffect(() => {
		if (!open) {
			focusedOnOpenRef.current = false;
			return;
		}
		if (position && !focusedOnOpenRef.current) {
			focusedOnOpenRef.current = true;
			if (searchRef.current) searchRef.current.focus();
			else menuRef.current?.focus();
		}
	}, [open, position]);

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

	const providerLabels = useMemo<Record<string, string>>(() => {
		const labels: Record<string, string> = {};
		for (const provider of providers) labels[provider.id] = provider.label;
		return labels;
	}, [providers]);

	const storedOptions = useMemo<StoredRunOptions>(
		() => ({ effort, speed, verbosity, mode }),
		[effort, speed, verbosity, mode],
	);

	const sections = useMemo(
		() => (house ? [] : optionSections(selected)),
		[house, selected],
	);

	const searchable = !house && shouldShowSearch(data?.models);
	const trimmedQuery = query.trim();
	const searchResults = useMemo(
		() => (trimmedQuery ? searchModels(data?.models, trimmedQuery) : []),
		[data, trimmedQuery],
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
		closeMenu();
	};

	/**
	 * Every chip stores its own id, defaults included, because the server reads
	 * an absent value as "no opinion, apply the stored account default"; writing
	 * null for Standard would leave someone who once chose Fast running Fast for
	 * good. The Auto chip has no id of its own, so it stores the sentinel rather
	 * than null, which would be indistinguishable from never having chosen.
	 */
	const pickOption = (section: OptionSectionKey, chipId: string | null) => {
		if (section === "reasoning") {
			const value = chipId ?? AUTO_EFFORT_SENTINEL;
			setEffort(value);
			writeEffortPref(value);
		} else if (section === "speed") {
			setSpeed(chipId);
			writeSpeedPref(chipId);
		} else if (section === "verbosity") {
			setVerbosity(chipId);
			writeVerbosityPref(chipId);
		} else {
			setMode(chipId);
			writeModePref(chipId);
		}
	};

	const activeLabel = house
		? house.label
		: summaryLabel(selected, storedOptions);

	/**
	 * One model row. `showProvider` is the flat search view, where a result
	 * has no accordion above it to say where it came from.
	 */
	const renderModelRow = (model: PickerModel, showProvider: boolean) => {
		const active = model.id === modelId;
		const pills = capabilityPills(model);
		const meta = modelMeta(model);
		const providerLabel = providerLabels[model.provider] ?? model.provider;
		const secondLine = showProvider
			? [providerLabel, meta].filter(Boolean).join(SUMMARY_SEPARATOR)
			: meta;
		return (
			<button
				type="button"
				key={model.id}
				role="option"
				aria-selected={active}
				onClick={() => pickModel(model)}
				className={`flex w-full items-start gap-2 py-2 pr-4 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05] ${
					showProvider ? "pl-4" : "pl-11"
				}`}
			>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5">
						<span
							className={`min-w-0 truncate text-sm ${
								active
									? "font-semibold text-amber-700 dark:text-amber-400"
									: "text-neutral-700 dark:text-neutral-300"
							}`}
						>
							{model.label}
						</span>
						{pills.map((pill) => (
							<span
								key={pill}
								className="flex-shrink-0 rounded border border-black/[0.08] px-1 py-px text-metadata font-bold uppercase leading-none tracking-wide text-neutral-400 dark:border-white/[0.08] dark:text-neutral-500"
							>
								{pill}
							</span>
						))}
					</span>
					{secondLine ? (
						<span className="mt-0.5 block truncate text-metadata text-neutral-400 dark:text-neutral-500">
							{secondLine}
						</span>
					) : null}
				</span>
				{active && (
					<Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
				)}
			</button>
		);
	};

	const menu = position && (
		<div
			ref={menuRef}
			id={menuId}
			tabIndex={-1}
			style={{
				left: position.left,
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				maxHeight: position.maxHeight,
				width: position.width,
			}}
			className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg outline-none dark:border-white/[0.08] dark:bg-neutral-900"
		>
			{house ? (
				<>
					<div
						className="min-h-0 flex-1 overflow-y-auto custom-scrollbar py-1"
						role="listbox"
						aria-label="AI model"
					>
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
					<div className="flex-shrink-0 border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
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
					{searchable && (
						<div className="flex-shrink-0 border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
							<div className="relative">
								<Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
								<input
									ref={searchRef}
									type="text"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										// Enter takes the top hit, so typing "sol" and
										// pressing Enter is the whole interaction.
										if (event.key !== "Enter" || searchResults.length === 0) return;
										event.preventDefault();
										pickModel(searchResults[0]);
									}}
									placeholder="Search models"
									aria-label="Search models"
									className="w-full rounded-lg border border-black/[0.08] bg-black/[0.02] py-1.5 pl-7 pr-2 text-support text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-amber-500/40 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-200 dark:placeholder:text-neutral-600"
								/>
							</div>
						</div>
					)}
					<div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar py-1">
						{trimmedQuery ? (
							searchResults.length > 0 ? (
								<div role="listbox" aria-label="Search results">
									{searchResults.map((model) => renderModelRow(model, true))}
								</div>
							) : (
								<p className="px-4 py-3 text-support text-neutral-400 dark:text-neutral-500">
									No models match that search.
								</p>
							)
						) : (
							providers.map((provider) => {
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
											providerModels.map((model) => renderModelRow(model, false))}
									</div>
								);
							})
						)}
					</div>
					{/* Natural height, so the model list above is what gives way. The
					    sections are kept to one chip row each (the seven reasoning
					    levels fit 328px unwrapped) with the caveat on the title line,
					    so all four stay visible instead of scrolling inside a sliver
					    under the list. The max-height only bites on a very short
					    viewport. */}
					{sections.length > 0 && (
						<div className="max-h-[62%] flex-shrink-0 space-y-2.5 overflow-y-auto custom-scrollbar border-t border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
							{sections.map((section) => {
								const activeId = activeChipId(section.key, storedOptions, selected);
								return (
									<div key={section.key} role="group" aria-label={section.ariaLabel}>
										<div className="mb-1.5 flex items-baseline justify-between gap-3">
											<p className="flex-shrink-0 text-metadata font-bold tracking-[0.12em] text-neutral-400 dark:text-neutral-500">
												{section.title}
											</p>
											{section.note ? (
												<p
													className="min-w-0 truncate text-metadata text-neutral-400 dark:text-neutral-500"
													title={section.note}
												>
													{section.note}
												</p>
											) : null}
										</div>
										<div className="flex flex-wrap gap-0.5">
											{section.chips.map((chip) => {
												const isActive = activeId === chip.id;
												return (
													<button
														type="button"
														key={chip.label}
														aria-pressed={isActive}
														onClick={() => pickOption(section.key, chip.id)}
														className={`${CHIP_BASE} ${isActive ? CHIP_ACTIVE : CHIP_IDLE}`}
													>
														{chip.label}
													</button>
												);
											})}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</>
			)}
		</div>
	);

	// min-w-0 so the wider summary chip shrinks with the composer instead of
	// pushing the attach and send buttons off a narrow screen.
	return (
		<div ref={containerRef} className="relative min-w-0">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={menuId}
				aria-label={`Choose AI model, currently ${activeLabel}`}
				title={activeLabel}
				className="flex h-11 max-w-[240px] items-center gap-1 rounded-lg border border-black/[0.08] px-2 text-xs font-semibold text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-amber-700 dark:border-white/[0.08] dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-amber-400"
			>
				<Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
				<span className="min-w-0 flex-1 truncate text-left">{activeLabel}</span>
				<ChevronDown className="h-3 w-3 flex-shrink-0" />
			</button>

			{open && typeof document !== "undefined"
				? createPortal(menu, document.body)
				: null}
		</div>
	);
};

export default ModelPicker;
