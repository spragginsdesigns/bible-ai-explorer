import AppSidebar from "./AppSidebar";
import SectionHeader from "./SectionHeader";
import type { PrimarySection } from "@/lib/primary-navigation";

export default function SectionShell({ active, children }: { active: PrimarySection; children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#f6f2e9] text-[#24281f] dark:bg-[#0d100d] dark:text-[#f1eadc]">
    <AppSidebar active={active} docked />
    <div className="lg:pl-[268px]"><SectionHeader />{children}</div>
  </div>;
}
