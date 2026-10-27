"use client";
import React, { useEffect, useRef } from "react";
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
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const height = nav.getBoundingClientRect().height;
      if (height > 0) document.documentElement.style.setProperty("--sureword-mobile-tab-clearance", `${height}px`);
      else document.documentElement.style.removeProperty("--sureword-mobile-tab-clearance");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--sureword-mobile-tab-clearance"); };
  }, []);
  return <nav ref={navRef} aria-label="Primary" className={`${styles.nav} ${pathname === "/" ? styles.chat : ""}`}>
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
  return <PrimaryNavigation pathname={pathname} />;
}
