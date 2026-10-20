"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, History, Link2, Search, X } from "lucide-react";
import type { WhatsNewEditorialFile, WhatsNewEntry, WhatsNewKind } from "@/lib/whats-new-rules";
import { releasesSince } from "@/lib/whats-new-rules";
import styles from "./whats-new.module.css";

type Beginning = WhatsNewEditorialFile["beginning"];
type KindFilter = "all" | WhatsNewKind;

const BEGINNING_ID = "beginning";
/** Releases listed before "Show older releases"; on a phone each is a full card. */
const PAGE_SIZE = 12;
const KIND_LABEL: Record<WhatsNewKind, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
	{ id: "all", label: "All changes" },
	{ id: "new", label: "New features" },
	{ id: "improved", label: "Improvements" },
	{ id: "fixed", label: "Fixes" },
];

// Changelog dates are calendar days, so format them in UTC: a reader west of
// Greenwich must not see a release land the day before it shipped.
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T12:00:00Z`);

function permalink(version: string): string {
	return version === BEGINNING_ID ? "/whats-new" : `/whats-new/${version}`;
}

function matches(entry: WhatsNewEntry, query: string, kind: KindFilter): boolean {
	if (kind !== "all" && !entry.sections.some((s) => s.kind === kind)) return false;
	if (!query) return true;
	const haystack = [entry.version, entry.title, entry.headline ?? "", ...entry.sections.flatMap((s) => s.items)]
		.join(" ")
		.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((word) => haystack.includes(word));
}

export default function ReleaseJournal({
	entries,
	beginning,
	initialVersion,
}: {
	entries: WhatsNewEntry[];
	beginning: Beginning;
	initialVersion: string;
}) {
	const [selected, setSelected] = useState(initialVersion);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<KindFilter>("all");
	const [since, setSince] = useState<number | null>(null);
	const [sincePick, setSincePick] = useState(() => String(entries[Math.min(6, entries.length - 1)]?.versionCode ?? ""));
	const [copied, setCopied] = useState(false);
	// A permalink to an old release still opens with that release in the list.
	const [limit, setLimit] = useState(() => Math.max(PAGE_SIZE, entries.findIndex((e) => e.version === initialVersion) + 1));

	const matching = useMemo(() => {
		const pool = since == null ? entries : releasesSince(entries, since);
		return pool.filter((e) => matches(e, query.trim(), kind));
	}, [entries, since, query, kind]);
	// Searching, filtering or catching up shows every match; browsing pages.
	const browsing = since == null && !query.trim() && kind === "all";
	const visible = browsing ? matching.slice(0, limit) : matching;
	const hidden = matching.length - visible.length;
	const showBeginning = browsing && hidden === 0;

	const months = useMemo(() => {
		const groups: { month: string; items: WhatsNewEntry[] }[] = [];
		for (const entry of visible) {
			const month = monthFormat.format(asDate(entry.date));
			const last = groups.at(-1);
			if (last?.month === month) last.items.push(entry);
			else groups.push({ month, items: [entry] });
		}
		return groups;
	}, [visible]);

	const current = entries.find((e) => e.version === selected) ?? null;
	// Newer/Older walks every match, not just the listed page.
	const order = [...matching.map((e) => e.version), ...(browsing ? [BEGINNING_ID] : [])];
	const at = order.indexOf(selected);

	function select(version: string) {
		const index = matching.findIndex((e) => e.version === version);
		if (version === BEGINNING_ID) setLimit(matching.length);
		else if (index >= 0) setLimit((n) => Math.max(n, index + 1));
		setSelected(version);
		setCopied(false);
		// Keep the address a shareable permalink without a navigation.
		window.history.replaceState(null, "", permalink(version));
	}

	function catchUp() {
		const code = Number(sincePick);
		if (!Number.isInteger(code)) return;
		setSince(code);
		setQuery("");
		setKind("all");
		const newest = releasesSince(entries, code)[0];
		if (newest) select(newest.version);
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(`${window.location.origin}${permalink(selected)}`);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	const sinceEntry = since == null ? null : entries.find((e) => e.versionCode === since);

	return (
		<>
			<form
				className={styles.catchUp}
				onSubmit={(event) => {
					event.preventDefault();
					catchUp();
				}}
			>
				<History aria-hidden className={styles.catchUpIcon} />
				<label htmlFor="whats-new-since">Been away? See what changed since</label>
				<div className={styles.catchUpControls}>
					<span className={styles.selectWrap}>
						<select id="whats-new-since" value={sincePick} onChange={(e) => setSincePick(e.target.value)}>
							{entries.slice(1).map((e) => (
								<option key={e.versionCode} value={e.versionCode}>
									{e.version}
								</option>
							))}
						</select>
						<ChevronDown aria-hidden />
					</span>
					<button type="submit" className={styles.goldButton}>
						Catch me up <ChevronRight aria-hidden />
					</button>
				</div>
			</form>

			<div className={styles.body}>
				<aside className={styles.sidebar} aria-label="Releases">
					<div className={styles.filters}>
						<label className={styles.search}>
							<Search aria-hidden />
							<span className="sr-only">Search release notes</span>
							<input
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search release notes"
							/>
						</label>
						<label className={styles.filterLabel}>
							Change type
							<span className={styles.selectWrap}>
								<select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
									{KIND_FILTERS.map((f) => (
										<option key={f.id} value={f.id}>
											{f.label}
										</option>
									))}
								</select>
								<ChevronDown aria-hidden />
							</span>
						</label>
					</div>

					{sinceEntry && (
						<p className={styles.sinceBanner} role="status">
							<span>
								{visible.length} {visible.length === 1 ? "release" : "releases"} since {sinceEntry.version}
							</span>
							<button type="button" onClick={() => setSince(null)} aria-label="Show every release">
								<X aria-hidden /> Show all
							</button>
						</p>
					)}
					{!sinceEntry && <p className={styles.count}>{matching.length} releases</p>}

					<ol className={styles.walk}>
						{months.map(({ month, items }) => (
							<li key={month} className={styles.month}>
								<h2 className={styles.monthLabel}>{month}</h2>
								<ol>
									{items.map((entry) => (
										<WalkItem
											key={entry.version}
											entry={entry}
											active={entry.version === selected}
											onSelect={() => select(entry.version)}
										/>
									))}
								</ol>
							</li>
						))}
						{showBeginning && (
							<li className={styles.month}>
								<h2 className={styles.monthLabel}>{beginning.dateRange}</h2>
								<ol>
									<li className={styles.walkItem}>
										<button
											type="button"
											className={styles.walkButton}
											aria-current={selected === BEGINNING_ID ? "true" : undefined}
											aria-expanded={selected === BEGINNING_ID}
											onClick={() => select(BEGINNING_ID)}
										>
											<span className={styles.walkVersion}>1.0 to 1.18</span>
											<span className={styles.walkTitle}>{beginning.title}</span>
											<span className={styles.walkMeta}>{beginning.dateRange}</span>
										</button>
										{selected === BEGINNING_ID && (
											<div className={styles.inlineDetail}>
												<BeginningBody beginning={beginning} />
											</div>
										)}
									</li>
								</ol>
							</li>
						)}
						{visible.length === 0 && <li className={styles.empty}>No release notes match that search.</li>}
					</ol>
					{hidden > 0 && (
						<button type="button" className={styles.showOlder} onClick={() => setLimit((n) => n + PAGE_SIZE * 2)}>
							Show older releases <span>({hidden} more)</span>
						</button>
					)}
				</aside>

				<article className={styles.pane} aria-live="polite">
					{current ? (
						<>
							<div className={styles.paneTop}>
								<p className={styles.eyebrow}>
									<span className={styles.kindBadge} data-kind={current.sections[0].kind}>
										{KIND_LABEL[current.sections[0].kind]}
									</span>
									<span>{dayFormat.format(asDate(current.date))}</span>
								</p>
								<button type="button" className={styles.copyLink} onClick={copyLink}>
									<Link2 aria-hidden /> {copied ? "Link copied" : "Copy link"}
								</button>
							</div>
							<h2 className={styles.version}>{current.version}</h2>
							<EntryBody entry={current} />
						</>
					) : (
						<>
							<p className={styles.eyebrow}>
								<span className={styles.kindBadge} data-kind="new">
									Beginnings
								</span>
								<span>{beginning.dateRange}</span>
							</p>
							<h2 className={styles.version}>1.0 to 1.18</h2>
							<BeginningBody beginning={beginning} />
						</>
					)}
					<nav className={styles.pager} aria-label="More releases">
						{at > 0 ? (
							<button type="button" onClick={() => select(order[at - 1])}>
								<ChevronLeft aria-hidden /> Newer release
							</button>
						) : (
							<span />
						)}
						{at >= 0 && at < order.length - 1 ? (
							<button type="button" onClick={() => select(order[at + 1])}>
								Older release <ChevronRight aria-hidden />
							</button>
						) : (
							<span />
						)}
					</nav>
				</article>
			</div>
		</>
	);
}

function WalkItem({ entry, active, onSelect }: { entry: WhatsNewEntry; active: boolean; onSelect: () => void }) {
	const lead = entry.sections[0].kind;
	return (
		<li className={styles.walkItem}>
			<button
				type="button"
				className={styles.walkButton}
				aria-current={active ? "true" : undefined}
				aria-expanded={active}
				onClick={onSelect}
			>
				<span className={styles.walkVersion}>
					{entry.version}
					{lead === "new" && <span className={styles.newDot}>New</span>}
				</span>
				<span className={styles.walkTitle}>{entry.title}</span>
				<span className={styles.walkMeta}>{dayFormat.format(asDate(entry.date))}</span>
			</button>
			{/* Phones read the release inline, in the path, instead of in the
			    side pane; CSS shows exactly one of the two. */}
			{active && (
				<div className={styles.inlineDetail}>
					<EntryBody entry={entry} />
				</div>
			)}
		</li>
	);
}

function EntryBody({ entry }: { entry: WhatsNewEntry }) {
	return (
		<>
			<h3 className={styles.headline}>{entry.headline ?? entry.title}</h3>
			{entry.why && (
				<section className={styles.why}>
					<h4>Why it changed</h4>
					<p>{entry.why}</p>
				</section>
			)}
			{entry.sections.map((section) => (
				<section key={section.kind} className={styles.section}>
					<h4>{KIND_LABEL[section.kind]}</h4>
					<ol className={styles.items}>
						{section.items.map((item, i) => (
							<li key={i}>
								<span className={styles.itemNumber} aria-hidden>
									{String(i + 1).padStart(2, "0")}
								</span>
								<span>{item}</span>
							</li>
						))}
					</ol>
				</section>
			))}
			{entry.verse && (
				<figure className={styles.verse}>
					<blockquote>{entry.verse.text}</blockquote>
					<figcaption>{entry.verse.reference} (KJV)</figcaption>
				</figure>
			)}
		</>
	);
}

function BeginningBody({ beginning }: { beginning: Beginning }) {
	return (
		<>
			<h3 className={styles.headline}>{beginning.title}</h3>
			<p className={styles.lede}>{beginning.summary}</p>
			<section className={styles.section}>
				<h4>The first releases brought</h4>
				<ol className={styles.items}>
					{beginning.items.map((item, i) => (
						<li key={i}>
							<span className={styles.itemNumber} aria-hidden>
								{String(i + 1).padStart(2, "0")}
							</span>
							<span>{item}</span>
						</li>
					))}
				</ol>
			</section>
		</>
	);
}
