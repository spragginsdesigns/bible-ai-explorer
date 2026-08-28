"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, Search, User, X } from "lucide-react";
import { bookByOrder } from "@/lib/bible/books";
import { relationLabelFor } from "@/lib/bible/atlas-core";
import type {
  AtlasEntityRef,
  AtlasEntityView,
  AtlasEventView,
  AtlasSearchHit,
} from "@/lib/bible/atlas-core";
import { readerHrefFor } from "./atlasLinks";
import {
  alsoCalledLine,
  atlasDateLabel,
  askPromptForEntity,
  askPromptForEvent,
  emptyTimelineMessage,
  entityCounts,
  entitySubtitle,
  eraChipLabel,
  hitKindLabel,
  USSHER_NOTE,
} from "./atlasView";
import {
  useAtlasEntities,
  useAtlasConnection,
  useAtlasEntity,
  useAtlasEvent,
  useAtlasSearch,
  useAtlasTimeline,
  useWhoIsIn,
} from "./useAtlas";

type Mode = "timeline" | "people" | "places";
type Selection =
  | { kind: "event"; id: string; event?: AtlasEventView }
  | { kind: "person" | "place"; id: string }
  | null;
const chipClass =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-1.5 text-[13px] font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors";
const refChipClass =
  "inline-flex min-h-[40px] items-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-3 py-1.5 text-[13px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors";
const sectionLabelClass =
  "pt-5 pb-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-amber-600/80 dark:text-amber-400/70";
function validMode(value: string | null): Mode {
  return value === "people" || value === "places" ? value : "timeline";
}

const AtlasScreen: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bookParam = searchParams.get("book");
  const chapterParam = searchParams.get("chapter");
  const parseStrictInteger = (value: string | null): number | null => {
    if (!value || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const book = parseStrictInteger(bookParam);
  const chapter = parseStrictInteger(chapterParam);
  const scopedBook = book === null ? null : bookByOrder(book);
  const hasScopeParams = bookParam !== null || chapterParam !== null;
  const invalidChapterScope =
    hasScopeParams &&
    (!scopedBook ||
      chapter === null ||
      chapter < 1 ||
      chapter > scopedBook.chapters);
  const chapterScope =
    !invalidChapterScope && scopedBook && book !== null && chapter !== null
      ? { order: scopedBook.order, chapter, name: scopedBook.name }
      : null;
  const mode = validMode(searchParams.get("mode"));
  const urlEra = searchParams.get("era") || null;
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [selected, setSelected] = useState<Selection>(null);
  const [journeyPersonId, setJourneyPersonId] = useState(
    searchParams.get("personId") || null,
  );
  const trimmed = query.trim();
  const scopeOrder = chapterScope?.order ?? null;
  const scopeChapter = chapterScope?.chapter ?? null;
  const updateUrl = useCallback(
    (
      changes: Record<string, string | null>,
      history: "replace" | "push" = "replace",
    ) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(changes).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      const qs = next.toString();
      const destination = qs ? `${pathname}?${qs}` : pathname;
      if (history === "push") router.push(destination, { scroll: false });
      else router.replace(destination, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setJourneyPersonId(searchParams.get("personId") || null);
  }, [searchParams]);
  const timeline = useAtlasTimeline(
    useMemo(
      () => ({
        ...(urlEra ? { era: urlEra } : {}),
        ...(scopeOrder && scopeChapter
          ? { book: scopeOrder, chapter: scopeChapter }
          : {}),
        ...(journeyPersonId ? { personId: journeyPersonId } : {}),
      }),
      [urlEra, scopeOrder, scopeChapter, journeyPersonId],
    ),
  );
  const {
    hits,
    counts,
    searching,
    error: searchError,
  } = useAtlasSearch(trimmed);
  const chapterView = useWhoIsIn(scopeOrder, scopeChapter);
  const directory = useAtlasEntities(
    mode === "timeline" ? null : mode === "places" ? "place" : "person",
    mode === "places" ? null : urlEra,
  );
  const selectedEntityId =
    selected?.kind === "person" || selected?.kind === "place"
      ? selected.id
      : null;
  const {
    entity,
    loading: entityLoading,
    error: entityError,
  } = useAtlasEntity(selectedEntityId);
  const selectedEventId = selected?.kind === "event" ? selected.id : null;
  const selectedEvent = selected?.kind === "event" ? selected.event : undefined;
  const fetchedEvent = useAtlasEvent(selectedEvent ? null : selectedEventId);
  useEffect(() => {
    const detail = searchParams.get("detail");
    if (!detail) {
      setSelected(null);
      return;
    }
    const [kind, ...parts] = detail.split(":");
    const id = parts.join(":");
    if (!id || (kind !== "event" && kind !== "person" && kind !== "place"))
      return;
    const nextSelection: Exclude<Selection, null> =
      kind === "event" ? { kind: "event", id } : { kind, id };
    setSelected((current) =>
      current && `${current.kind}:${current.id}` === detail
        ? current
        : nextSelection,
    );
  }, [searchParams]);
  const openDetail = (selection: Exclude<Selection, null>) => {
    setSelected(selection);
    updateUrl({ detail: `${selection.kind}:${selection.id}` }, "push");
  };
  const closeDetail = useCallback(() => {
    setSelected(null);
    updateUrl({ detail: null });
  }, [updateUrl]);
  const openHit = (hit: AtlasSearchHit) => {
    if (hit.kind === "event") {
      const event = timeline.events.find(
        (candidate) => candidate.id === hit.id,
      );
      openDetail(
        event
          ? { kind: "event", id: event.id, event }
          : { kind: "event", id: hit.id },
      );
    } else openDetail({ kind: hit.kind, id: hit.id });
  };
  const ask = (prompt: string) =>
    router.push(`/?prompt=${encodeURIComponent(prompt)}`);
  const selectMode = (next: Mode) => {
    updateUrl({
      mode: next === "timeline" ? null : next,
      era: next === "places" ? null : urlEra,
      personId: null,
    });
    setJourneyPersonId(null);
  };
  const selectEra = (next: string | null) => updateUrl({ era: next });
  const detailContent = selected ? (
    selected.kind === "event" ? (
      fetchedEvent.loading && !selectedEvent ? (
        <LoadingText text="Opening event…" />
      ) : fetchedEvent.error && !selectedEvent ? (
        <ErrorText message={fetchedEvent.error} />
      ) : (selectedEvent ?? fetchedEvent.event) ? (
        <EventDetail
          event={(selectedEvent ?? fetchedEvent.event) as AtlasEventView}
          onOpenEntity={(item) => openDetail(item)}
          onAsk={() =>
            askPrompt(
              ask,
              (selectedEvent ?? fetchedEvent.event) as AtlasEventView,
            )
          }
        />
      ) : (
        <EmptyText text="That event is not in the Bible atlas." />
      )
    ) : entityLoading ? (
      <LoadingText text="Opening entry…" />
    ) : entityError ? (
      <ErrorText message={entityError} />
    ) : entity ? (
      <EntityDetail
        entity={entity}
        onOpenEntity={(item) => openDetail(item)}
        onOpenEvent={(id) => openDetail({ kind: "event", id })}
        onAsk={() => ask(askPromptForEntity(entity))}
        onViewJourney={(id) => {
          setSelected(null);
          setJourneyPersonId(id);
          updateUrl({ detail: null, mode: null, personId: id });
        }}
      />
    ) : (
      <EmptyText text="That entry is not in the Bible atlas." />
    )
  ) : null;
  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl lg:max-w-6xl px-5 lg:px-8 pb-28 lg:pb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
        <main className="min-w-0">
          <div className="flex items-center gap-4 py-3 lg:py-6">
            <Link
              href="/bible"
              className="min-h-[40px] pt-2 text-[15px] font-semibold text-amber-600 dark:text-amber-400"
            >
              ‹ Bible
            </Link>
            <h1 className="flex-1 truncate text-center font-[family-name:var(--font-pirata)] text-3xl lg:text-4xl text-neutral-900 dark:text-neutral-100">
              {chapterScope
                ? `${chapterScope.name} ${chapterScope.chapter}`
                : "Bible Atlas"}
            </h1>
            <span className="w-14" aria-hidden />
          </div>
          <p className="mb-4 text-center text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
            <span className="font-bold text-amber-600 dark:text-amber-400">
              Traditional chronology
            </span>{" "}
            · Explore the people, places and turning points of the Bible through
            Ussher&apos;s historical framework.
          </p>
          <nav
            aria-label="Atlas views"
            className="grid grid-cols-3 gap-1 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] p-1"
          >
            {(["timeline", "people", "places"] as Mode[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-current={mode === item ? "page" : undefined}
                onClick={() => selectMode(item)}
                className={`min-h-[44px] rounded-lg text-sm font-bold capitalize transition-colors ${mode === item ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"}`}
              >
                {item}
              </button>
            ))}
          </nav>
          <label className="mt-4 flex items-center gap-2 rounded-full border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-2.5">
            <Search
              className="h-4 w-4 flex-shrink-0 text-neutral-400"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                updateUrl({ q: event.target.value.trim() || null });
              }}
              placeholder="Search people, places and events"
              aria-label="Search the Bible atlas"
              className="w-full bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  updateUrl({ q: null });
                }}
                className="min-h-[32px] min-w-[32px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X className="mx-auto h-4 w-4" aria-hidden />
              </button>
            )}
          </label>
          {!trimmed && mode !== "places" && timeline.allEras.length > 0 && (
            <div
              className="flex flex-nowrap gap-2 overflow-x-auto py-4"
              aria-label="Timeline eras"
            >
              <EraChip
                label="All"
                active={!urlEra}
                onClick={() => selectEra(null)}
              />
              {timeline.allEras.map((name) => (
                <EraChip
                  key={name}
                  label={eraChipLabel(name)}
                  title={name}
                  active={urlEra === name}
                  onClick={() => selectEra(urlEra === name ? null : name)}
                />
              ))}
            </div>
          )}
          {chapterScope && chapterView && !trimmed && mode === "timeline" && (
            <div className="pt-1">
              <p className={sectionLabelClass}>Who&apos;s in this chapter</p>
              {chapterView.people.length === 0 &&
              chapterView.places.length === 0 ? (
                <p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                  The atlas records no one and nowhere by name in{" "}
                  {chapterScope.name} {chapterScope.chapter}.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...chapterView.people, ...chapterView.places].map(
                    (item) => (
                      <EntityChip
                        key={`${item.kind}-${item.id}`}
                        entity={item}
                        onClick={() =>
                          openDetail({ kind: item.kind, id: item.id })
                        }
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          )}
          {invalidChapterScope ? (
            <EmptyText text="That is not a chapter of the Bible. Choose a book and chapter from the reader." />
          ) : trimmed ? (
            <SearchResults
              hits={hits}
              counts={counts}
              searching={searching}
              error={searchError}
              onOpen={openHit}
            />
          ) : mode === "timeline" ? (
            <TimelineBody
              timeline={timeline}
              emptyMessage={emptyTimelineMessage({
                ...(chapterScope
                  ? { book: chapterScope.name, chapter: chapterScope.chapter }
                  : {}),
                ...(urlEra ? { era: urlEra } : {}),
              })}
              onOpenEvent={(event) =>
                openDetail({ kind: "event", id: event.id, event })
              }
            />
          ) : (
            <DirectoryBody
              kind={mode === "places" ? "place" : "person"}
              data={directory}
              onOpen={(item) => openDetail(item)}
            />
          )}
        </main>
        {selected && (
          <aside
            className="sticky top-6 hidden min-w-0 lg:block"
            aria-label="Atlas detail"
          >
            <DetailCard
              onClose={closeDetail}
              title={
                selected.kind === "event"
                  ? (selectedEvent ?? fetchedEvent.event)?.title
                  : entity?.name
              }
            >
              {detailContent}
            </DetailCard>
          </aside>
        )}
      </div>
      {selected && (
        <div className="lg:hidden">
          <DetailPanel
            onClose={closeDetail}
            title={
              selected.kind === "event"
                ? (selectedEvent ?? fetchedEvent.event)?.title
                : entity?.name
            }
          >
            {detailContent}
          </DetailPanel>
        </div>
      )}
    </div>
  );
};
function askPrompt(ask: (prompt: string) => void, event: AtlasEventView) {
  ask(askPromptForEvent(event));
}

function SearchResults({
  hits,
  counts,
  searching,
  error,
  onOpen,
}: {
  hits: AtlasSearchHit[];
  counts: Partial<Record<AtlasSearchHit["kind"], number>>;
  searching: boolean;
  error: string | null;
  onOpen: (hit: AtlasSearchHit) => void;
}) {
  if (searching && hits.length === 0)
    return <LoadingText text="Searching the atlas…" />;
  if (error) return <ErrorText message={error} />;
  if (hits.length === 0)
    return (
      <EmptyText text="Nothing in the atlas matches that search. Try another spelling, or the name the King James Bible uses." />
    );
  const groupedHits = (["person", "place", "event"] as const).map((kind) => ({
    kind,
    hits: hits.filter((hit) => hit.kind === kind),
  }));
  return (
    <div className="pt-5">
      <div className="mb-3 flex flex-wrap gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
        {(["person", "place", "event"] as const)
          .filter((kind) => counts[kind] !== undefined)
          .map((kind) => (
            <span
              key={kind}
              className="rounded-full border border-black/[0.08] dark:border-white/[0.08] px-3 py-1"
            >
              {counts[kind]} {kind}
              {counts[kind] === 1 ? "" : "s"}
            </span>
          ))}
      </div>
      {groupedHits.map(({ kind, hits: sectionHits }) =>
        sectionHits.length > 0 ? (
          <section key={kind} className="mb-5">
            <h2 className={sectionLabelClass}>
              {hitKindLabel(kind)} ({counts[kind] ?? sectionHits.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {sectionHits.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(hit)}
                    className="flex min-h-[76px] w-full items-center gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:border-amber-500/30 hover:bg-black/[0.06] dark:border-white/[0.06] dark:hover:border-amber-400/20 dark:hover:bg-white/[0.06]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-neutral-900 dark:text-neutral-100">
                        {hit.name}
                      </span>
                      {hit.disambiguator && (
                        <span className="block text-[11.5px] text-neutral-400 dark:text-neutral-500">
                          {hit.disambiguator}
                        </span>
                      )}
                      <span className="mt-0.5 block line-clamp-2 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                        {hit.description}
                      </span>
                      <span className="mt-1 block text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {atlasDateLabel(
                            undefined,
                            hit.yearLabel ?? undefined,
                          )}
                        </span>
                        {hit.era ? ` · ${hit.era}` : ""}
                        {hit.refs[0] ? ` · ${hit.refs[0]}` : ""}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="text-lg font-semibold text-neutral-400"
                    >
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
function TimelineBody({
  timeline,
  emptyMessage,
  onOpenEvent,
}: {
  timeline: ReturnType<typeof useAtlasTimeline>;
  emptyMessage: string;
  onOpenEvent: (event: AtlasEventView) => void;
}) {
  if (timeline.error)
    return <ErrorText message={timeline.error} onRetry={timeline.reload} />;
  if (timeline.loading) return <LoadingText text="Opening the timeline…" />;
  if (timeline.events.length === 0) return <EmptyText text={emptyMessage} />;
  return (
    <div className="pt-4">
      {timeline.eras.map((group) => (
        <section key={group.era}>
          <p className={sectionLabelClass}>{group.era}</p>
          <ol className="relative">
            {group.events.map((event) => (
              <li key={event.id} className="relative flex gap-4 pb-5">
                <span
                  aria-hidden
                  className="relative flex w-7 flex-shrink-0 flex-col items-center"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold text-amber-600 dark:text-amber-400 shadow-[0_0_6px_rgba(200,160,40,0.5)]">
                    ✦
                  </span>
                  <span className="mt-1 w-0.5 flex-1 rounded bg-amber-500/25 dark:bg-amber-400/20" />
                </span>
                <button
                  type="button"
                  onClick={() => onOpenEvent(event)}
                  className="min-h-[108px] min-w-0 flex-1 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:border-amber-500/30 dark:hover:border-amber-400/20 transition-colors"
                >
                  <span className="block text-[11.5px] font-bold tabular-nums tracking-wide text-amber-600 dark:text-amber-400">
                    {atlasDateLabel(event.date, event.yearLabel)}
                  </span>
                  <span className="mt-0.5 block text-[15.5px] font-bold leading-6 text-neutral-900 dark:text-neutral-100">
                    {event.title}
                  </span>
                  <span className="mt-1 block line-clamp-3 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                    {event.summary}
                  </span>
                  <span className="mt-1.5 block text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
                    {event.refs.join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="pt-4 text-[11.5px] leading-5 text-neutral-400/80 dark:text-neutral-500">
        {USSHER_NOTE}
      </p>
    </div>
  );
}
function DirectoryBody({
  kind,
  data,
  onOpen,
}: {
  kind: "person" | "place";
  data: ReturnType<typeof useAtlasEntities>;
  onOpen: (entity: AtlasEntityRef) => void;
}) {
  if (data.error && data.items.length === 0)
    return <ErrorText message={data.error} onRetry={data.reload} />;
  if (data.loading && data.items.length === 0)
    return (
      <LoadingText
        text={`Opening ${kind === "person" ? "people" : "places"}…`}
      />
    );
  if (data.items.length === 0)
    return (
      <EmptyText
        text={`No ${kind === "person" ? "people" : "places"} match this filter.`}
      />
    );
  return (
    <div className="pt-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {data.items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex min-h-[68px] w-full items-center gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {kind === "person" ? (
                  <User className="h-4 w-4" aria-hidden />
                ) : (
                  <MapPin className="h-4 w-4" aria-hidden />
                )}
              </span>
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                {item.name}
              </span>
              {item.disambiguator && (
                <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                  {item.disambiguator}
                </span>
              )}
              <span aria-hidden className="ml-auto text-lg text-neutral-400">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.nextCursor && (
        <button
          type="button"
          onClick={data.loadMore}
          disabled={data.loadingMore}
          className="mt-5 min-h-[44px] w-full rounded-lg border border-amber-500/40 px-4 text-sm font-bold text-amber-600 dark:text-amber-400"
        >
          {data.loadingMore ? "Loading more…" : "Load more"}
        </button>
      )}
      {data.error && (
        <p className="mt-3 text-center text-xs text-red-600 dark:text-red-400">
          {data.error}
        </p>
      )}
    </div>
  );
}
function EraChip({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[40px] flex-shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${active ? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400" : "border-black/[0.1] dark:border-white/[0.08] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"}`}
    >
      {label}
    </button>
  );
}
function EntityChip({
  entity,
  onClick,
}: {
  entity: AtlasEntityRef;
  onClick: () => void;
}) {
  const Icon = entity.kind === "person" ? User : MapPin;
  return (
    <button type="button" onClick={onClick} className={chipClass}>
      <Icon className="h-3 w-3 flex-shrink-0 text-neutral-400" aria-hidden />
      <span className="min-w-0 text-left">
        <span className="block truncate">{entity.name}</span>
        {entity.disambiguator && (
          <span className="block truncate text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
            {entity.disambiguator}
          </span>
        )}
      </span>
    </button>
  );
}
function DetailPanel({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const prior = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          "button, a, input, [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((item) => !item.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      prior?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-detail-title"
        className="glass-card relative h-[100dvh] max-h-[100dvh] w-full overflow-y-auto rounded-none border border-black/10 dark:border-white/10 bg-white p-6 dark:bg-neutral-950 sm:h-auto sm:max-h-[85dvh] sm:max-w-xl sm:rounded-2xl"
      >
        <button
          type="button"
          aria-label="Close detail"
          onClick={onClose}
          className="absolute right-4 top-4 min-h-[40px] min-w-[40px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <X className="mx-auto h-5 w-5" aria-hidden />
        </button>
        <h2 id="atlas-detail-title" className="sr-only">
          {title ?? "Atlas detail"}
        </h2>
        {children}
      </div>
    </div>
  );
}

function DetailCard({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
}) {
  return (
    <div className="glass-card relative max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-neutral-950">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute right-4 top-4 min-h-[40px] min-w-[40px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        <X className="mx-auto h-5 w-5" aria-hidden />
      </button>
      <h2 className="sr-only">{title ?? "Atlas detail"}</h2>
      {children}
    </div>
  );
}
function ReferenceChips({ refs }: { refs: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {refs.map((reference) => {
        const href = readerHrefFor(reference);
        return href ? (
          <Link key={reference} href={href} className={refChipClass}>
            {reference} ›
          </Link>
        ) : (
          <span key={reference} className={refChipClass}>
            {reference}
          </span>
        );
      })}
    </div>
  );
}
function AskButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[15px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
    >
      ✦ Ask about this
    </button>
  );
}
function EventDetail({
  event,
  onOpenEntity,
  onAsk,
}: {
  event: AtlasEventView;
  onOpenEntity: (entity: AtlasEntityRef) => void;
  onAsk: () => void;
}) {
  return (
    <>
      <h3 className="pr-8 font-[family-name:var(--font-pirata)] text-2xl text-neutral-900 dark:text-neutral-100">
        {event.title}
      </h3>
      <p className="mt-1 text-[12.5px] font-semibold text-neutral-400 dark:text-neutral-500">
        {atlasDateLabel(event.date, event.yearLabel)} · {event.era}
      </p>
      <p className="mt-3 text-[14.5px] leading-6 text-neutral-700 dark:text-neutral-300">
        {event.summary}
      </p>
      <p className={sectionLabelClass}>In Scripture</p>
      <ReferenceChips refs={event.refs} />
      {(event.people.length > 0 || event.places.length > 0) && (
        <>
          <p className={sectionLabelClass}>Who and where</p>
          <div className="flex flex-wrap gap-2">
            {[...event.people, ...event.places].map((item) => (
              <EntityChip
                key={`${item.kind}-${item.id}`}
                entity={item}
                onClick={() => onOpenEntity(item)}
              />
            ))}
          </div>
        </>
      )}
      <AskButton onClick={onAsk} />
    </>
  );
}
type RelationEntry = AtlasEntityView["relationDetails"][number];
function relationEntries(entity: AtlasEntityView): RelationEntry[] {
  return entity.relationDetails;
}
function EntityDetail({
  entity,
  onOpenEntity,
  onOpenEvent,
  onAsk,
  onViewJourney,
}: {
  entity: AtlasEntityView;
  onOpenEntity: (entity: AtlasEntityRef) => void;
  onOpenEvent: (id: string) => void;
  onAsk: () => void;
  onViewJourney: (id: string) => void;
}) {
  const relations = relationEntries(entity);
  const typedEntityIds = new Set(relations.map((entry) => entry.entity.id));
  const legacyConnections = entity.related.filter(
    (related) => !typedEntityIds.has(related.id),
  );
  const hasRelationData = relations.length > 0 || legacyConnections.length > 0;
  const [selectedRelationId, setSelectedRelationId] = useState(
    relations[0]?.relation.id ?? null,
  );
  const selectedRelation =
    relations.find((relation) => relation.relation.id === selectedRelationId) ??
    null;
  const [traceOpen, setTraceOpen] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const targetSearch = useAtlasSearch(targetQuery, 180, 25);
  const connection = useAtlasConnection(
    entity.kind === "person" ? entity.id : null,
    connectionTarget || null,
  );
  const targetPeople = targetSearch.hits.filter(
    (hit) => hit.kind === "person" && hit.id !== entity.id,
  );
  useEffect(() => {
    setSelectedRelationId(relations[0]?.relation.id ?? null);
    setTraceOpen(false);
    setConnectionTarget("");
    setTargetQuery("");
  }, [entity.id, relations]);
  return (
    <>
      <h3 className="pr-8 font-[family-name:var(--font-pirata)] text-3xl text-neutral-900 dark:text-neutral-100">
        {entity.name}
      </h3>
      {entity.disambiguator && (
        <p className="mt-0.5 text-[12.5px] text-neutral-400 dark:text-neutral-500">
          {entity.disambiguator}
        </p>
      )}
      <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
        {entitySubtitle(entity)}
      </p>
      {alsoCalledLine(entity) && (
        <p className="mt-0.5 text-[12.5px] italic text-neutral-400 dark:text-neutral-500">
          {alsoCalledLine(entity)}
        </p>
      )}
      <p className="mt-4 text-[15px] leading-6 text-neutral-700 dark:text-neutral-300">
        {entity.description}
      </p>
      <p className="mt-2 text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
        {entityCounts(entity)}
      </p>
      <p className={sectionLabelClass}>In Scripture</p>
      <ReferenceChips refs={entity.refs} />
      {hasRelationData && (
        <>
          <p className={sectionLabelClass}>
            {entity.kind === "person"
              ? "Family & relationships"
              : "Connected to"}
          </p>
          <div className="flex flex-col gap-2">
            {relations.map((related) => (
              <button
                type="button"
                key={related.relation.id}
                onClick={() => setSelectedRelationId(related.relation.id)}
                className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3 text-left ${selectedRelation?.relation.id === related.relation.id ? "border-amber-500/50 bg-amber-500/10" : "border-black/[0.08] bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03]"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-amber-600 dark:text-amber-400">
                    {related.entity.kind === "person" ? (
                      <User className="h-4 w-4" aria-hidden />
                    ) : (
                      <MapPin className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      {related.entity.name}
                    </span>
                    {related.entity.disambiguator && (
                      <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                        {related.entity.disambiguator}
                      </span>
                    )}
                  </span>
                </span>
                <span className="ml-3 flex-shrink-0 text-right text-[11px] capitalize text-neutral-400 dark:text-neutral-500">
                  {related.label} · {related.relation.certainty}
                </span>
              </button>
            ))}
          </div>
          {legacyConnections.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">
                Other recorded connections
              </p>
              <div className="flex flex-wrap gap-2">
                {legacyConnections.map((related) => (
                  <EntityChip
                    key={`${related.kind}-${related.id}`}
                    entity={related}
                    onClick={() => onOpenEntity(related)}
                  />
                ))}
              </div>
            </div>
          )}
          {selectedRelation && (
            <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
              <p className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                {selectedRelation.label} · {selectedRelation.relation.certainty}
              </p>
              {selectedRelation.relation.refs.length > 0 && (
                <div className="mt-2">
                  <ReferenceChips refs={selectedRelation.relation.refs} />
                </div>
              )}
              <button
                type="button"
                onClick={() => onOpenEntity(selectedRelation.entity)}
                className="mt-2 min-h-[40px] text-sm font-bold text-amber-600 dark:text-amber-400"
              >
                Open {selectedRelation.entity.name} →
              </button>
            </div>
          )}
          {entity.kind === "person" && (
            <>
              <button
                type="button"
                onClick={() => setTraceOpen((value) => !value)}
                className="mt-3 min-h-[44px] rounded-lg border border-amber-500/40 px-4 text-sm font-semibold text-amber-600 dark:text-amber-400"
              >
                {traceOpen ? "Hide connection trace" : "Trace connection"}
              </button>
              {traceOpen && (
                <div className="mt-3 rounded-xl bg-amber-500/10 p-3">
                  <label
                    className="block text-[12px] font-semibold text-neutral-600 dark:text-neutral-300"
                    htmlFor="atlas-connection-target"
                  >
                    Trace to another person
                  </label>
                  <input
                    id="atlas-connection-target"
                    value={targetQuery}
                    onChange={(event) => {
                      setTargetQuery(event.target.value);
                      setConnectionTarget("");
                    }}
                    placeholder="Search any person"
                    className="mt-2 min-h-[44px] w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-neutral-800 dark:border-white/10 dark:bg-neutral-950 dark:text-neutral-200"
                  />
                  {targetSearch.searching && (
                    <p className="mt-2 text-[12px] text-neutral-500">
                      Searching people…
                    </p>
                  )}
                  {targetPeople.length > 0 && !connectionTarget && (
                    <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {targetPeople.map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setConnectionTarget(person.id);
                              setTargetQuery(person.name);
                            }}
                            className="flex min-h-[44px] w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
                          >
                            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                              {person.name}
                            </span>
                            {person.disambiguator && (
                              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                                {person.disambiguator}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {connectionTarget && (
                    <button
                      type="button"
                      onClick={() => {
                        setConnectionTarget("");
                        setTargetQuery("");
                      }}
                      className="mt-2 min-h-[40px] text-[12px] font-bold text-amber-600 dark:text-amber-400"
                    >
                      Clear target
                    </button>
                  )}
                  {connection.loading && (
                    <LoadingText text="Tracing the shortest cited path…" />
                  )}
                  {connection.error && (
                    <p className="mt-2 text-[13px] text-red-600 dark:text-red-400">
                      {connection.error}
                    </p>
                  )}
                  {!connection.loading &&
                    !connection.error &&
                    connectionTarget &&
                    !connection.path && (
                      <p className="mt-2 text-[13px] text-neutral-600 dark:text-neutral-300">
                        No cited connection was found.
                      </p>
                    )}
                  {connection.path && (
                    <ol className="mt-3 flex flex-col gap-2">
                      {connection.path.entities.map((step, index) => (
                        <li
                          key={`${step.id}-${index}`}
                          className="rounded-lg border border-amber-500/20 bg-white/50 p-2 dark:bg-black/20"
                        >
                          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                            {index + 1}. {step.name}
                          </p>
                          {step.disambiguator && (
                            <p className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                              {step.disambiguator}
                            </p>
                          )}
                          {connection.path?.relations[index] && (
                            <div className="mt-1">
                              <p className="text-[12px] capitalize text-neutral-500 dark:text-neutral-400">
                                {relationLabelFor(
                                  connection.path.relations[index],
                                  step.id,
                                )} ·{" "}
                                {connection.path.relations[index].certainty}
                              </p>
                              <ReferenceChips
                                refs={connection.path.relations[index].refs}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {entity.events.length > 0 && (
        <>
          <p className={sectionLabelClass}>On the timeline</p>
          <ul className="flex flex-col gap-2">
            {entity.events.slice(0, 5).map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onOpenEvent(event.id)}
                  className="flex min-h-[58px] w-full items-center gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 text-left"
                >
                  <span className="w-36 flex-shrink-0 text-[11.5px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {atlasDateLabel(undefined, event.yearLabel)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-neutral-700 dark:text-neutral-300">
                      {event.title}
                    </span>
                    <span className="block text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
                      {event.era}
                    </span>
                  </span>
                  <span aria-hidden className="text-lg text-neutral-400">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {entity.kind === "person" && entity.events.length > 5 && (
            <button
              type="button"
              onClick={() => onViewJourney(entity.id)}
              className="mt-2 min-h-[44px] text-sm font-bold text-amber-600 dark:text-amber-400"
            >
              View all {entity.events.length} events →
            </button>
          )}
        </>
      )}
      <AskButton onClick={onAsk} />
    </>
  );
}
function LoadingText({ text }: { text: string }) {
  return (
    <p className="py-12 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
      {text}
    </p>
  );
}
function EmptyText({ text }: { text: string }) {
  return (
    <div className="glass-card mt-6 rounded-2xl p-6">
      <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
        {text}
      </p>
    </div>
  );
}
function ErrorText({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="glass-card mt-6 flex flex-col items-center gap-4 rounded-2xl p-8">
      <p className="text-center text-sm text-neutral-600 dark:text-neutral-300">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] rounded-lg border border-amber-500/40 bg-amber-500/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400"
        >
          Try again
        </button>
      )}
    </div>
  );
}
export default AtlasScreen;
