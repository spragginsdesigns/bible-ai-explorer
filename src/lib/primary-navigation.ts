/** Existing URLs keep their meaning while their primary section changes. */
export type PrimarySection = "today" | "bible" | "chat" | "connections" | "study";

export const PRIMARY_DESTINATIONS = [
  { id: "today", href: "/today", label: "Today" },
  { id: "bible", href: "/bible", label: "Bible" },
  { id: "chat", href: "/", label: "Chat" },
  { id: "connections", href: "/connections", label: "Connections" },
  { id: "study", href: "/study", label: "Study" },
] as const;

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

export function primarySectionForPath(pathname: string): PrimarySection | null {
  const path = pathname.split(/[?#]/)[0];
  if (path === "/") return "chat";
  if (["/today", "/cross", "/bible/cross", "/bible/plan", "/bible/learn", "/bible/history", "/serve"].some(root => within(path, root))) return "today";
  if (["/study", "/notes", "/sermons", "/bible/timeline", "/bible/atlas"].some(root => within(path, root))) return "study";
  if (within(path, "/connections")) return "connections";
  if (within(path, "/bible")) return "bible";
  return null;
}
