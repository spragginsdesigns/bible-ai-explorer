"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock, Sun, Moon, Plus, Smartphone, Settings, MoreVertical } from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";
import GetAppLink from "./GetAppLink";
import styles from "./ChatTopBar.module.css";
interface ChatTopBarProps { title: string; onToggleSidebar: () => void; onNewChat: () => void }
const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar, onNewChat }) => {
  const { setTheme } = useTheme();
  return <header className={styles.header}>
    <Image src="/chat-home/sureword-mark.png" width={48} height={48} alt="" className={styles.mark} />
    <div className={styles.title}>
      <span className="font-[family-name:var(--font-pirata)]">SureWord</span>
      {title !== "New Chat" && <small>{title}</small>}
    </div>
    <button type="button" className={styles.newChat} onClick={onNewChat} aria-label="New chat"><Plus size={24} /></button>
    <details className={styles.options}>
      <summary aria-label="Chat options"><MoreVertical size={22} /></summary>
      <div className={styles.menu}>
        <button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onToggleSidebar(); }}><Clock size={20} /> Conversation history</button>
        <GetAppLink source="chat-top-bar" className={styles.row}><Smartphone size={20} /> Get the app</GetAppLink>
        <button type="button" onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>
          <Sun size={20} className="hidden dark:block" /><Moon size={20} className="block dark:hidden" /> Toggle theme
        </button>
        <Link href="/settings" className={styles.row}><Settings size={20} /> Settings</Link>
        <div className={styles.row}><UserButton /><span>Account</span></div>
      </div>
    </details>
  </header>;
};
export default React.memo(ChatTopBar);
