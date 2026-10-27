"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Brain, CircleHelp, Clock, Sun, Moon, Plus, Smartphone, Settings, MoreVertical, Type } from "lucide-react";
import { useTheme } from "next-themes";
import { UserButton } from "@clerk/nextjs";
import GetAppLink from "./GetAppLink";
import TextSizeDialog from "./walk/TextSizeDialog";
import styles from "./ChatTopBar.module.css";
interface ChatTopBarProps { title: string; onToggleSidebar: () => void; onNewChat: () => void; onHelp?: () => void }
const ChatTopBar: React.FC<ChatTopBarProps> = ({ title, onToggleSidebar, onNewChat, onHelp }) => {
  const { setTheme } = useTheme();
  const [textSizeOpen, setTextSizeOpen] = React.useState(false);
  const optionsRef = React.useRef<HTMLDetailsElement>(null);
  const openTextSize = () => {
    optionsRef.current?.removeAttribute("open");
    // The menu row is hidden on close; restore focus to the persistent trigger.
    optionsRef.current?.querySelector("summary")?.focus();
    setTextSizeOpen(true);
  };
  return <><header className={styles.header}>
    <Image src="/chat-home/sureword-mark.png" width={48} height={48} alt="" className={styles.mark} />
    <div className={styles.title}>
      <span className="font-[family-name:var(--font-pirata)]">SureWord</span>
      {title !== "New Chat" && <small>{title}</small>}
    </div>
    {/* The screen's "?" (Walk with me): a fresh chat that asks SureWord about Chat itself. */}
    {onHelp && <button type="button" className={styles.help} onClick={onHelp} aria-label="Help with Chat" title="Help"><CircleHelp size={24} /></button>}
    <button type="button" className={styles.newChat} onClick={onNewChat} aria-label="New chat"><Plus size={24} /></button>
    <details ref={optionsRef} className={styles.options}>
      <summary aria-label="Chat options"><MoreVertical size={22} /></summary>
      <div className={styles.menu}>
        <button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onToggleSidebar(); }}><Clock size={20} /> Conversation history</button>
        <GetAppLink source="chat-top-bar" className={styles.row}><Smartphone size={20} /> Get the app</GetAppLink>
        <button type="button" onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>
          <Sun size={20} className="hidden dark:block" /><Moon size={20} className="block dark:hidden" /> Toggle theme
        </button>
        <button type="button" onClick={openTextSize}><Type size={20} /> Text size</button>
        <Link href="/settings" className={styles.row}><Settings size={20} /> Settings</Link>
        <Link href="/settings#memory" className={styles.row}><Brain size={20} /> Memories</Link>
        <div className={styles.row}><UserButton /><span>Account</span></div>
      </div>
    </details>
  </header>{textSizeOpen && <TextSizeDialog onClose={() => setTextSizeOpen(false)} />}</>;
};
export default React.memo(ChatTopBar);
