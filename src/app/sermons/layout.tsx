import AppSidebar from "@/components/AppSidebar";

/**
 * Sermon studies live under the Bible section, same docked-sidebar shell as
 * /bible and /cross so desktop navigation stays persistent.
 */
export default function SermonsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<AppSidebar active="bible" docked />
			<div className="lg:pl-[268px]">{children}</div>
		</div>
	);
}
