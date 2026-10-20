import Link from "next/link";
import AppOptions from "./AppOptions";

export default function SectionHeader() {
  return <header className="relative z-30 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-3 lg:px-8 lg:pt-5">
    <Link href="/today" aria-label="SureWord Today" className="font-[family-name:var(--font-pirata)] text-[30px] leading-none text-neutral-900 dark:text-[#f1eadc]">SureWord</Link>
    <AppOptions />
  </header>;
}
