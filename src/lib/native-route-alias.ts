export type NativeRouteQuery = Record<string, string | string[] | undefined>;
export type NativeRouteSection = "today" | "study" | "bible-atlas";

/** Native section ownership can change without breaking an already shared URL. */
export function nativeRouteAlias(section: NativeRouteSection, path: readonly string[], query: NativeRouteQuery): string | null {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item));
    else if (value !== undefined) params.append(key, value);
  }
  let destination: string | null = null;
  const [page, id] = path;
  if (section === "today" && path.length === 1) {
    const destinations: Record<string, string> = { cross: "/cross", plan: "/bible/plan", learn: "/bible/learn", history: "/bible/history", chapter: "/bible/chapter" };
    destination = Object.hasOwn(destinations, page) ? destinations[page] : null;
  }
  if (section === "study") {
    if (page === "notes" && path.length <= 2) {
      destination = "/notes";
      if (id) params.set("note", id);
    } else if (page === "timeline" && path.length === 1) destination = "/bible/timeline";
    else if (page === "chapter" && path.length === 1) destination = "/bible/chapter";
    else if (page === "sermons" && path.length === 1) destination = "/sermons";
    else if (page === "sermon" || (page === "sermons" && id)) {
      const studyId = id || params.get("id");
      if (studyId && studyId !== "." && studyId !== ".." && path.length <= 2) destination = `/sermons/${encodeURIComponent(studyId)}`;
    }
  }
  const atlasPath = section === "bible-atlas" ? path : section === "study" && page === "atlas" ? path.slice(1) : null;
  if (atlasPath) {
    const [kindOrId, entityId] = atlasPath;
    destination = "/bible/timeline";
    if (atlasPath.length === 1) params.set("detail", `${params.get("kind") === "place" ? "place" : "person"}:${kindOrId}`);
    else if (atlasPath.length === 2 && ["event", "family", "trace"].includes(kindOrId)) {
      if (kindOrId === "trace") {
        params.delete("detail");
        params.set("personId", entityId);
      } else params.set("detail", `${kindOrId === "event" ? "event" : "person"}:${entityId}`);
    } else if (atlasPath.length > 0) return null;
  }
  if (!destination) return null;
  const suffix = params.toString();
  return suffix ? `${destination}?${suffix}` : destination;
}
