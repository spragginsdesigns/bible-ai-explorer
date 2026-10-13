"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { MessageCircle, BookOpen, FileText } from "lucide-react";
import styles from "./MobileBottomNav.module.css";
const TABS = [
  { href: "/", label: "Chat", Icon: MessageCircle, isActive: (path: string) => path === "/" },
  { href: "/bible", label: "Bible", Icon: BookOpen, isActive: (path: string) => ["/bible", "/cross", "/sermons"].some(prefix => path === prefix || path.startsWith(`${prefix}/`)) },
  { href: "/notes", label: "Notes", Icon: FileText, isActive: (path: string) => path.startsWith("/notes") },
] as const;
/** Pure presentation shared with local UI fixtures. The real shell retains its session guard. */
export function PrimaryNavigation({ pathname }: { pathname: string }) {
  return <nav aria-label="Primary" className={`${styles.nav} ${pathname === "/" ? styles.chat : ""}`}>
    <div className={styles.tabs}>{TABS.map(({ href, label, Icon, isActive }) => {
      const active = isActive(pathname);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined}>
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
