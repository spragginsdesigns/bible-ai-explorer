import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

export const destinationClass = "group flex w-full min-h-24 items-center gap-4 rounded-[22px] border border-black/[.09] bg-white/35 px-5 py-4 text-left transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:border-white/[.09] dark:bg-white/[.025] dark:hover:border-amber-300/30 dark:hover:bg-white/[.05]";

export default function DestinationCard({ href, title, description, Icon }: { href: string; title: string; description: string; Icon: LucideIcon }) {
  return <Link href={href} className={destinationClass}>
    <Icon size={28} strokeWidth={1.5} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
    <span className="min-w-0 flex-1"><span className="block text-lg font-bold leading-snug">{title}</span><span className="mt-1 block text-sm leading-5 text-neutral-600 dark:text-[#bbb3a7]">{description}</span></span>
    <ChevronRight size={22} className="shrink-0 text-neutral-500 transition-transform group-hover:translate-x-1" aria-hidden />
  </Link>;
}
