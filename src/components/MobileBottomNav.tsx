"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { MessageCircle, BookOpen, Sun, Network, Compass } from "lucide-react";
import { PRIMARY_DESTINATIONS, primarySectionForPath } from "@/lib/primary-navigation";
import { spotlightTarget } from "@/lib/spotlight";
import styles from "./MobileBottomNav.module.css";
const ICONS = { today: Sun, bible: BookOpen, chat: MessageCircle, connections: Network, study: Compass };
/** Pure presentation shared with local UI fixtures. The real shell retains its session guard. */
export function PrimaryNavigation({ pathname }: { pathname: string }) {
  return <nav aria-label="Primary" className={`${styles.nav} ${pathname === "/" ? styles.chat : ""}`}>
    <div className={styles.tabs}>{PRIMARY_DESTINATIONS.map(({ id, href, label }) => {
      const Icon = ICONS[id];
      const active = primarySectionForPath(pathname) === id;
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined} {...spotlightTarget(`tab.${id}` as const)}>
        <Icon size={24} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
      </Link>;
    })}</div>
  </nav>;
}
export default function MobileBottomNav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  if (!isSignedIn || pathname === "/terms" || ["/sign-in", "/sign-up"].some(prefix => pathname.startsWith(prefix))) return null;
  // SureWord Beta draws its own tab bar (components/beta/BetaShell.tsx).
  if (pathname === "/beta" || pathname.startsWith("/beta/")) return null;
  return <PrimaryNavigation pathname={pathname} />;
}
