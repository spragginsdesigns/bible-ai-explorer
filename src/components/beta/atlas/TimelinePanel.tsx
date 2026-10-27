"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight, Route } from "lucide-react";
import { readerHrefFor } from "@/components/atlas/atlasLinks";
import { activeSpans, buildTimelineScale, formatYear, nearestDated, spanCovers, stepToNext, type TimelineScale } from "@/lib/beta/atlas/atlas-rules";
import type { AtlasEraView, AtlasLaneSpanView, AtlasLaneView, AtlasTimelineEvent } from "@/lib/beta/atlas/types";
import type { AtlasSelection } from "./useAtlasData";
import { SourceChip, SOURCE_HINT, TIMELINE_DATE_NOTE, atlasCard, atlasChip, atlasChipOn, atlasEyebrow, atlasHeading } from "./atlasUi";

interface TimelinePanelProps {
	eras: readonly AtlasEraView[];
	lanes: readonly AtlasLaneView[];
	events: readonly AtlasTimelineEvent[];
	year: number;
	era: string | null;
	onYear: (year: number) => void;
	onEra: (era: string | null) => void;
	onOpen: (selection: AtlasSelection) => void;
	onJourney: (journeyId: string) => void;
}

/** One quiet tint per era, alternating so neighbours are told apart. */
const ERA_TINT = [
	"bg-[#e7d8b4] dark:bg-[#3a3424]",
	"bg-[#d9c79f] dark:bg-[#2d2a1e]",
];

/** How long a lane keeps saying what became of it. */
const AFTER_YEARS = 160;

function laneCoverage(lane: AtlasLaneView, eventById: ReadonlyMap<string, AtlasTimelineEvent>): [number, number] | null {
	const years = [
		...lane.spans.flatMap((span) => [span.start, span.end]),
		...lane.events.flatMap((id) => {
			const event = eventById.get(id);
			return event?.dated ? [event.start, event.end] : [];
		}),
	];
	return years.length ? [Math.min(...years), Math.max(...years)] : null;
}

/**
 * The scrubbable timeline (LC-17655): drag across the centuries, or step from
 * event to event, and see side by side who reigned in Israel and in Judah,
 * which prophets were speaking, and what happened nearest that year. Every
 * span says where its years come from (Ussher, the corpus's dating, or the
 * reigns Scripture names).
 */
export default function TimelinePanel({ eras, lanes, events, year, era, onYear, onEra, onOpen, onJourney }: TimelinePanelProps) {
	const dated = useMemo(() => events.filter((event) => event.dated), [events]);
	const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
	const focusedEra = era ? eras.find((entry) => entry.era === era) ?? null : null;

	const scale: TimelineScale = useMemo(() => {
		if (focusedEra) {
			const pad = Math.max(4, Math.round((focusedEra.end - focusedEra.start) * 0.04));
			return buildTimelineScale([{ start: focusedEra.start - pad, end: Math.min(96, focusedEra.end + pad), weight: 1 }]);
		}
		return buildTimelineScale(eras.map((entry) => ({ start: entry.scaleStart, end: entry.scaleEnd, weight: entry.weight })));
	}, [eras, focusedEra]);

	const stepYears = useMemo(() => [...dated.map((event) => event.start), ...lanes.flatMap((lane) => lane.spans.map((span) => span.start))], [dated, lanes]);
	const erasNow = eras.filter((entry) => year >= entry.start && year <= entry.end);
	const nearby = useMemo(() => nearestDated(dated, year, 4), [dated, year]);

	return (
		<div className="flex flex-col gap-5">
			<div role="group" aria-label="Zoom the timeline to an era" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
				<button type="button" aria-pressed={!era} onClick={() => onEra(null)} className={`${!era ? atlasChipOn : atlasChip} shrink-0`}>
					All of Scripture
				</button>
				{eras.map((entry) => (
					<button key={entry.era} type="button" aria-pressed={era === entry.era} onClick={() => onEra(entry.era)} className={`${era === entry.era ? atlasChipOn : atlasChip} shrink-0`}>
						{entry.era}
					</button>
				))}
			</div>

			<header>
				<p className={atlasEyebrow}>{erasNow.map((entry) => entry.era).join(" · ") || "Between the eras"}</p>
				<h2 className={`${atlasHeading} mt-1 text-[2.6rem] tabular-nums`}>c. {formatYear(year)}</h2>
			</header>

			<Scrubber scale={scale} eras={focusedEra ? [focusedEra] : eras} lanes={lanes} events={dated} eventById={eventById} year={year} onYear={onYear} stepYears={stepYears} erasNow={erasNow} />

			<div className="flex items-center gap-2">
				<button type="button" onClick={() => onYear(stepToNext(stepYears, year, -1))} className={atlasChip}>
					<ChevronLeft size={17} aria-hidden /> Earlier
				</button>
				<button type="button" onClick={() => onYear(stepToNext(stepYears, year, 1))} className={atlasChip}>
					Later <ChevronRight size={17} aria-hidden />
				</button>
				<p className="ml-auto hidden text-xs text-neutral-600 sm:block dark:text-[#9d9686]">Drag, or use the arrow keys</p>
			</div>

			<NowPanel lanes={lanes} year={year} eventById={eventById} onJourney={onJourney} />

			<section aria-label={`Events nearest ${formatYear(year)}`}>
				<h3 className={atlasEyebrow}>Nearest events</h3>
				<ul className="mt-3 space-y-2">
					{nearby.map((event) => (
						<li key={event.id}>
							<button type="button" onClick={() => onOpen({ kind: "event", id: event.id })} className={`${atlasCard} flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left hover:border-amber-700/30 dark:hover:border-amber-300/30`}>
								<span className="min-w-0 flex-1">
									<span className="block font-semibold">{event.title}</span>
									<span className="block text-xs text-neutral-600 dark:text-[#9d9686]">
										{event.label} · {event.era}
									</span>
								</span>
								<ChevronRight size={18} className="shrink-0 text-neutral-500" aria-hidden />
							</button>
						</li>
					))}
				</ul>
			</section>

			<footer className="space-y-2 text-xs leading-5 text-neutral-600 dark:text-[#9d9686]">
				<p>{TIMELINE_DATE_NOTE}</p>
				<p>
					<strong>Ussher</strong>: {SOURCE_HINT.ussher} <strong>Traditional dating</strong>: {SOURCE_HINT.corpus} <strong>Dated by reigns</strong>: {SOURCE_HINT.reigns}
				</p>
			</footer>
		</div>
	);
}

function Scrubber({
	scale,
	eras,
	lanes,
	events,
	eventById,
	year,
	onYear,
	stepYears,
	erasNow,
}: {
	scale: TimelineScale;
	eras: readonly AtlasEraView[];
	lanes: readonly AtlasLaneView[];
	events: readonly AtlasTimelineEvent[];
	eventById: ReadonlyMap<string, AtlasTimelineEvent>;
	year: number;
	onYear: (year: number) => void;
	stepYears: readonly number[];
	erasNow: readonly AtlasEraView[];
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const pct = (value: number) => `${(scale.toPosition(value) * 100).toFixed(3)}%`;
	const width = (start: number, end: number) => `max(3px, ${((scale.toPosition(end) - scale.toPosition(start)) * 100).toFixed(3)}%)`;
	const inView = (start: number, end: number) => end >= scale.min && start <= scale.max;

	const yearAt = (clientX: number) => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return year;
		return scale.toYear((clientX - rect.left) / rect.width);
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const big = event.shiftKey ? 10 : 1;
		const keys: Record<string, () => number> = {
			ArrowLeft: () => year - big,
			ArrowDown: () => year - big,
			ArrowRight: () => year + big,
			ArrowUp: () => year + big,
			PageDown: () => stepToNext(stepYears, year, -1),
			PageUp: () => stepToNext(stepYears, year, 1),
			Home: () => scale.min,
			End: () => scale.max,
		};
		const next = keys[event.key];
		if (!next) return;
		event.preventDefault();
		let value = Math.min(scale.max, Math.max(scale.min, next()));
		if (value === 0) value = year < 0 ? 1 : -1;
		onYear(value);
	};

	const rows = lanes.map((lane) => ({ lane, coverage: laneCoverage(lane, eventById) }));

	return (
		<div className="grid grid-cols-[68px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[84px_minmax(0,1fr)]">
			<div aria-hidden className="flex flex-col pt-[3px] text-xs font-semibold leading-none text-neutral-600 dark:text-[#9d9686]">
				<span className="flex h-8 items-center">Eras</span>
				{rows.map(({ lane }) => (
					<span key={lane.id} className="flex h-[18px] items-center truncate" title={lane.title}>
						{lane.short}
					</span>
				))}
				<span className="flex h-[18px] items-center">Events</span>
			</div>
			<div
				ref={trackRef}
				role="slider"
				tabIndex={0}
				aria-label="Year"
				aria-valuemin={scale.min}
				aria-valuemax={scale.max}
				aria-valuenow={year}
				aria-valuetext={`c. ${formatYear(year)}${erasNow.length ? `, ${erasNow.map((entry) => entry.era).join(" and ")}` : ""}`}
				onKeyDown={onKeyDown}
				onPointerDown={(event) => {
					dragging.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
					onYear(yearAt(event.clientX));
				}}
				onPointerMove={(event) => {
					if (dragging.current) onYear(yearAt(event.clientX));
				}}
				onPointerUp={() => {
					dragging.current = false;
				}}
				onPointerCancel={() => {
					dragging.current = false;
				}}
				className="relative cursor-ew-resize touch-pan-y select-none rounded-[14px] pb-12 pt-[3px] outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
			>
				<div className="relative h-8 overflow-hidden rounded-[10px]">
					{eras.map((entry, index) =>
						inView(entry.scaleStart, entry.scaleEnd) ? (
							<span
								key={entry.era}
								className={`absolute inset-y-0 flex items-center overflow-hidden border-r border-[#f6f2e9] px-1 text-xs font-bold uppercase tracking-wide text-[#5b4a2c] dark:border-[#0d100d] dark:text-[#c8bba0] ${ERA_TINT[index % 2]}`}
								style={{ left: pct(eras.length === 1 ? entry.start : entry.scaleStart), width: width(eras.length === 1 ? entry.start : entry.scaleStart, eras.length === 1 ? entry.end : entry.scaleEnd) }}
								title={entry.era}
							>
								<span className="truncate">{entry.era}</span>
							</span>
						) : null
					)}
				</div>
				{rows.map(({ lane }) => (
					<div key={lane.id} className="relative h-[18px]">
						<span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-black/[.07] dark:bg-white/[.07]" />
						{lane.spans.map((span) =>
							inView(span.start, span.end) ? (
								<span
									key={span.id}
									title={`${span.label}, ${span.when}`}
									className={`absolute top-[4px] h-[10px] rounded-[3px] border border-[#f6f2e9] dark:border-[#0d100d] ${spanCovers(span, year) ? "bg-[#a86f12] dark:bg-[#e5b664]" : span.source === "reigns" ? "bg-[#a86f12]/30 dark:bg-[#e5b664]/30" : "bg-[#6b5d43]/55 dark:bg-[#c8bba0]/45"}`}
									style={{ left: pct(span.start), width: width(span.start, span.end) }}
								/>
							) : null
						)}
						{lane.events.map((id) => {
							const event = eventById.get(id);
							if (!event?.dated || !inView(event.start, event.end)) return null;
							return <span key={id} className="absolute top-[5px] h-2 w-2 -translate-x-1/2 rotate-45 bg-[#24281f] dark:bg-[#f1eadc]" style={{ left: pct(event.start) }} />;
						})}
					</div>
				))}
				<div className="relative h-[18px]">
					{events.map((event) =>
						inView(event.start, event.start) ? <span key={event.id} className="absolute top-[3px] h-3 w-px bg-[#5b4a2c]/60 dark:bg-[#c8bba0]/50" style={{ left: pct(event.start) }} /> : null
					)}
				</div>
				<span aria-hidden className="pointer-events-none absolute bottom-11 top-0 w-0.5 -translate-x-1/2 bg-[#a86f12] dark:bg-[#e5b664]" style={{ left: pct(year) }} />
				<span
					aria-hidden
					className="pointer-events-none absolute bottom-0 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[#a86f12] bg-[#fbf7ee] text-xs font-bold text-[#5b4a2c] dark:border-[#e5b664] dark:bg-[#151a14] dark:text-[#e5b664]"
					style={{ left: pct(year) }}
				>
					{Math.abs(year)}
				</span>
			</div>
		</div>
	);
}

function SpanItem({ span, onJourney }: { span: AtlasLaneSpanView; onJourney: (id: string) => void }) {
	return (
		<li className="space-y-2">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span className="font-semibold">{span.label}</span>
				<span className="text-sm text-neutral-600 dark:text-[#bbb3a7]">{span.when}</span>
				<SourceChip source={span.source} />
			</div>
			{span.note ? <p className="text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">{span.note}</p> : null}
			<ul className="flex flex-wrap gap-x-4">
				{span.refs.map((ref) => {
					const href = readerHrefFor(ref);
					return (
						<li key={ref}>
							{href ? (
								<Link href={href} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-sm font-bold text-amber-800 underline-offset-2 hover:underline dark:text-[#e5b664]">
									<BookOpen size={14} aria-hidden /> {ref}
								</Link>
							) : (
								<span className="text-sm font-bold">{ref}</span>
							)}
						</li>
					);
				})}
			</ul>
			{span.journey ? (
				<button type="button" onClick={() => onJourney(span.journey as string)} className={atlasChip}>
					<Route size={15} aria-hidden /> Play the journey
				</button>
			) : null}
		</li>
	);
}

/** Who and what at the scrubbed year, the two kingdoms side by side. */
function NowPanel({
	lanes,
	year,
	eventById,
	onJourney,
}: {
	lanes: readonly AtlasLaneView[];
	year: number;
	eventById: ReadonlyMap<string, AtlasTimelineEvent>;
	onJourney: (id: string) => void;
}) {
	const blocks = lanes.flatMap((lane) => {
		const coverage = laneCoverage(lane, eventById);
		if (!coverage) return [];
		const active = activeSpans(lane.spans, year);
		const inside = year >= coverage[0] && year <= coverage[1];
		const afterwards = !inside && year > coverage[1] && year <= coverage[1] + AFTER_YEARS && lane.after;
		if (!inside && !afterwards) return [];
		const message = active.length ? null : afterwards ? lane.after : lane.gap;
		if (!active.length && !message) return [];
		return [{ lane, active, message }];
	});
	const kings = blocks.filter((block) => block.lane.id === "israel" || block.lane.id === "judah");
	const others = blocks.filter((block) => block.lane.id !== "israel" && block.lane.id !== "judah");
	const prophets = lanes.find((lane) => lane.id === "prophets");
	const prophetsCoverage = prophets ? laneCoverage(prophets, eventById) : null;
	const showUndated = prophets && prophetsCoverage && year >= prophetsCoverage[0] && year <= prophetsCoverage[1] && prophets.undated.length > 0;

	if (blocks.length === 0) {
		return <p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">No reign or ministry on these lanes covers this year. The nearest events are below.</p>;
	}

	return (
		<section aria-label={`At ${formatYear(year)}`} className="flex flex-col gap-3">
			{kings.length ? (
				<div className="grid grid-cols-2 gap-3">
					{(["israel", "judah"] as const).map((id) => {
						const block = kings.find((entry) => entry.lane.id === id);
						return (
							<div key={id} className={`${atlasCard} min-w-0 p-3.5 sm:p-4`}>
								<h3 className={atlasEyebrow}>{id === "israel" ? "Israel" : "Judah"}</h3>
								<p className="text-xs text-neutral-600 dark:text-[#9d9686]">{id === "israel" ? "The northern kingdom" : "The southern kingdom"}</p>
								{block?.active.length ? (
									<ul className="mt-3 space-y-4">
										{block.active.map((span) => (
											<SpanItem key={span.id} span={span} onJourney={onJourney} />
										))}
									</ul>
								) : (
									<p className="mt-3 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">{block?.message ?? "Not yet divided."}</p>
								)}
							</div>
						);
					})}
				</div>
			) : null}
			{others.map(({ lane, active, message }) => (
				<div key={lane.id} className={`${atlasCard} p-4`}>
					<h3 className={atlasEyebrow}>{lane.title}</h3>
					{active.length ? (
						<ul className="mt-3 space-y-4">
							{active.map((span) => (
								<SpanItem key={span.id} span={span} onJourney={onJourney} />
							))}
						</ul>
					) : (
						<p className="mt-3 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">{message}</p>
					)}
					{lane.id === "prophets" && showUndated ? (
						<p className="mt-3 text-xs leading-5 text-neutral-600 dark:text-[#9d9686]">
							Not on the timeline, because their books name no king:{" "}
							{prophets.undated.map((entry, index) => {
								const href = readerHrefFor(entry.refs[0]);
								return (
									<span key={entry.label}>
										{index > 0 ? ", " : ""}
										{href ? (
											<Link href={href} className="font-bold text-amber-800 underline underline-offset-2 dark:text-[#e5b664]">
												{entry.label}
											</Link>
										) : (
											entry.label
										)}
									</span>
								);
							})}
							.
						</p>
					) : null}
				</div>
			))}
		</section>
	);
}
