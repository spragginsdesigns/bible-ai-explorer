"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Search, User, X } from "lucide-react";
import { bookByOrder } from "@/lib/bible/books";
import type {
  AtlasEntityRef,
  AtlasEntityView,
  AtlasEventView,
  AtlasSearchHit,
} from "@/lib/bible/atlas-core";
import { readerHrefFor } from "./atlasLinks";
import {
  alsoCalledLine,
  askPromptForEntity,
  askPromptForEvent,
  emptyTimelineMessage,
  entityCounts,
  entitySubtitle,
  eraChipLabel,
  eventCaption,
  hitKindLabel,
  USSHER_NOTE,
} from "./atlasView";
import { useAtlasEntity, useAtlasSearch, useAtlasTimeline, useWhoIsIn } from "./useAtlas";

type Selection =
  | { kind: "event"; event: AtlasEventView }
  | { kind: "entity"; id: string }
  | null;

const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-1.5 text-[13px] font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors";

const refChipClass =
  "inline-flex items-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-3 py-1.5 text-[13px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors";

const sectionLabelClass =
  "pt-5 pb-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-amber-600/80 dark:text-amber-400/70";

/**
 * Timeline, People & Places: the events of Bible history on one gold rail,
 * divided into the nine eras, with every person and place searchable by name.
 *
 * 1:1 with mobile/app/(app)/bible/timeline.tsx and its atlas/[id] detail
 * screen; the phone reads the bundled atlas, and this reads the same data over
 * /api/bible/atlas so the browser never downloads it. `?book=&chapter=` narrows
 * the whole screen to one chapter - the reader's "Who's in this chapter".
 */
const AtlasScreen: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const bookParam = Number.parseInt(searchParams.get("book") ?? "", 10);
  const chapterParam = Number.parseInt(searchParams.get("chapter") ?? "", 10);
  const scopedBook = bookByOrder(bookParam);
  const chapterScope =
    scopedBook && Number.isInteger(chapterParam) && chapterParam > 0
      ? { order: scopedBook.order, chapter: chapterParam, name: scopedBook.name }
      : null;

  const [query, setQuery] = useState("");
  const [era, setEra] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);

  const trimmed = query.trim();

  // Scalars, not the object: the memo below must not re-run on every render
  // just because `chapterScope` is rebuilt each time.
  const scopeOrder = chapterScope?.order ?? null;
  const scopeChapter = chapterScope?.chapter ?? null;

  const timeline = useAtlasTimeline(
    useMemo(
      () => ({
        ...(era ? { era } : {}),
        ...(scopeOrder && scopeChapter ? { book: scopeOrder, chapter: scopeChapter } : {}),
      }),
      [era, scopeOrder, scopeChapter]
    )
  );
  const { hits, searching } = useAtlasSearch(trimmed);
  const chapterView = useWhoIsIn(scopeOrder, scopeChapter);
  const { entity, loading: entityLoading } = useAtlasEntity(
    selected?.kind === "entity" ? selected.id : null
  );

  // An event the search found may sit outside the era filter, so it is not in
  // the loaded timeline yet. Remember it, drop the filter, and open it as soon
  // as the wider timeline arrives.
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingEventId) return;
    const event = timeline.events.find((candidate) => candidate.id === pendingEventId);
    if (!event) return;
    setSelected({ kind: "event", event });
    setPendingEventId(null);
  }, [pendingEventId, timeline.events]);

  const openHit = (hit: AtlasSearchHit) => {
    if (hit.kind === "event") {
      const event = timeline.events.find((candidate) => candidate.id === hit.id);
      if (event) {
        setSelected({ kind: "event", event });
      } else {
        setPendingEventId(hit.id);
        setEra(null);
      }
      return;
    }
    setSelected({ kind: "entity", id: hit.id });
  };

  const ask = (prompt: string) => {
    router.push(`/?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="min-h-[100dvh] gradient-mesh">
      <div className="mx-auto w-full max-w-2xl lg:max-w-5xl px-5 lg:px-8 pb-28 lg:pb-16">
        {/* Header */}
        <div className="flex items-center gap-4 py-3 lg:py-6">
          <Link
            href="/bible"
            className="text-[15px] font-semibold text-amber-600 dark:text-amber-400"
          >
            ‹ Bible
          </Link>
          <h1 className="flex-1 truncate text-center font-[family-name:var(--font-pirata)] text-3xl lg:text-4xl text-neutral-900 dark:text-neutral-100">
            {chapterScope ? `${chapterScope.name} ${chapterScope.chapter}` : "Timeline & People"}
          </h1>
          <span className="w-14" aria-hidden />
        </div>

        {/* Search */}
        <label className="flex items-center gap-2 rounded-full border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-2.5">
          <Search className="h-4 w-4 flex-shrink-0 text-neutral-400" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people, places and events"
            aria-label="Search the Bible atlas"
            className="w-full bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </label>

        {/* Era chips */}
        {!trimmed && !chapterScope && timeline.allEras.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-4">
            <EraChip label="All" active={era === null} onClick={() => setEra(null)} />
            {timeline.allEras.map((name) => (
              <EraChip
                key={name}
                label={eraChipLabel(name)}
                title={name}
                active={era === name}
                onClick={() => setEra(era === name ? null : name)}
              />
            ))}
          </div>
        )}

        {/* Who's in this chapter */}
        {chapterScope && chapterView && !trimmed && (
          <div className="pt-2">
            <p className={sectionLabelClass}>Who&apos;s in this chapter</p>
            {chapterView.people.length === 0 && chapterView.places.length === 0 ? (
              <p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                The atlas records no one and nowhere by name in {chapterScope.name}{" "}
                {chapterScope.chapter}.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...chapterView.people, ...chapterView.places].map((item) => (
                  <EntityChip
                    key={`${item.kind}-${item.id}`}
                    entity={item}
                    onClick={() => setSelected({ kind: "entity", id: item.id })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Body: search results, or the rail */}
        {trimmed ? (
          <div className="pt-5">
            {searching && hits.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
                Searching the atlas…
              </p>
            ) : hits.length === 0 ? (
              <div className="glass-card rounded-2xl p-6">
                <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  Nothing in the atlas is called &ldquo;{trimmed}&rdquo;. Try another spelling, or the
                  name the King James Bible uses.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {hits.map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button
                      type="button"
                      onClick={() => openHit(hit)}
                      className="flex w-full items-center gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3.5 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold text-neutral-900 dark:text-neutral-100">
                          {hit.name}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                          {hit.description}
                        </span>
                        <span className="mt-1 block text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
                          {hitKindLabel(hit.kind)}
                          {hit.yearLabel ? ` · ${hit.yearLabel}` : hit.era ? ` · ${hit.era}` : ""}
                          {` · ${hit.refs[0]}`}
                        </span>
                      </span>
                      <span aria-hidden className="text-lg font-semibold text-neutral-400">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : timeline.error ? (
          <div className="glass-card mt-6 flex flex-col items-center gap-4 rounded-2xl p-8">
            <p className="text-center text-sm text-neutral-600 dark:text-neutral-300">
              {timeline.error}
            </p>
            <button
              type="button"
              onClick={timeline.reload}
              className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400"
            >
              Try again
            </button>
          </div>
        ) : timeline.loading ? (
          <p className="py-12 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
            Opening the timeline…
          </p>
        ) : timeline.events.length === 0 ? (
          <div className="glass-card mt-6 rounded-2xl p-6">
            <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {emptyTimelineMessage({
                ...(chapterScope
                  ? { book: chapterScope.name, chapter: chapterScope.chapter }
                  : {}),
                ...(era ? { era } : {}),
              })}
            </p>
          </div>
        ) : (
          <div className="pt-4">
            {timeline.eras.map((group) => (
              <section key={group.era}>
                <p className={sectionLabelClass}>{group.era}</p>
                <ol className="relative">
                  {group.events.map((event) => (
                    <li key={event.id} className="relative flex gap-4 pb-5">
                      {/* The gold rail, matching the Pick Up Your Cross timeline */}
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
                        onClick={() => setSelected({ kind: "event", event })}
                        className="min-w-0 flex-1 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:border-amber-500/30 dark:hover:border-amber-400/20 transition-colors"
                      >
                        <span className="block text-[11.5px] font-bold tabular-nums tracking-wide text-amber-600 dark:text-amber-400">
                          {event.yearLabel}
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
        )}
      </div>

      {/* Detail: an event, or a person/place */}
      {selected && (
        <DetailPanel onClose={() => setSelected(null)}>
          {selected.kind === "event" ? (
            <EventDetail
              event={selected.event}
              onOpenEntity={(id) => setSelected({ kind: "entity", id })}
              onAsk={() => ask(askPromptForEvent(selected.event))}
            />
          ) : entityLoading ? (
            <p className="py-8 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
              Opening…
            </p>
          ) : entity ? (
            <EntityDetail
              entity={entity}
              onOpenEntity={(id) => setSelected({ kind: "entity", id })}
              onAsk={() => ask(askPromptForEntity(entity))}
            />
          ) : (
            <p className="py-8 text-center text-sm text-neutral-600 dark:text-neutral-300">
              That entry is not in the Bible atlas.
            </p>
          )}
        </DetailPanel>
      )}
    </div>
  );
};

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
      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active
          ? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
          : "border-black/[0.1] dark:border-white/[0.08] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
      }`}
    >
      {label}
    </button>
  );
}

function EntityChip({ entity, onClick }: { entity: AtlasEntityRef; onClick: () => void }) {
  const Icon = entity.kind === "person" ? User : MapPin;
  return (
    <button type="button" onClick={onClick} className={chipClass}>
      <Icon className="h-3 w-3 flex-shrink-0 text-neutral-400" aria-hidden />
      {entity.name}
    </button>
  );
}

/** A bottom sheet on phones, a centred card on desktop - Android's sheet. */
function DetailPanel({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="glass-card relative max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-950 p-6 sm:rounded-2xl">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        {children}
      </div>
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
  onOpenEntity: (id: string) => void;
  onAsk: () => void;
}) {
  return (
    <>
      <h2 className="pr-8 font-[family-name:var(--font-pirata)] text-2xl text-neutral-900 dark:text-neutral-100">
        {event.title}
      </h2>
      <p className="mt-1 text-[12.5px] font-semibold text-neutral-400 dark:text-neutral-500">
        {eventCaption(event)}
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
                onClick={() => onOpenEntity(item.id)}
              />
            ))}
          </div>
        </>
      )}

      <AskButton onClick={onAsk} />
    </>
  );
}

function EntityDetail({
  entity,
  onOpenEntity,
  onAsk,
}: {
  entity: AtlasEntityView;
  onOpenEntity: (id: string) => void;
  onAsk: () => void;
}) {
  return (
    <>
      <h2 className="pr-8 font-[family-name:var(--font-pirata)] text-3xl text-neutral-900 dark:text-neutral-100">
        {entity.name}
      </h2>
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

      {entity.related.length > 0 && (
        <>
          <p className={sectionLabelClass}>Connected to</p>
          <div className="flex flex-wrap gap-2">
            {entity.related.map((related) => (
              <EntityChip
                key={`${related.kind}-${related.id}`}
                entity={related}
                onClick={() => onOpenEntity(related.id)}
              />
            ))}
          </div>
        </>
      )}

      {entity.events.length > 0 && (
        <>
          <p className={sectionLabelClass}>On the timeline</p>
          <ul className="flex flex-col gap-2">
            {entity.events.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-4 py-3"
              >
                <span className="w-24 flex-shrink-0 text-[11.5px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {event.yearLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-neutral-700 dark:text-neutral-300">
                    {event.title}
                  </span>
                  <span className="block text-[11.5px] text-neutral-400/80 dark:text-neutral-500">
                    {event.era}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <AskButton onClick={onAsk} />
    </>
  );
}

export default AtlasScreen;
