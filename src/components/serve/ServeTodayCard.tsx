"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { HandHeart } from "lucide-react";
import DestinationCard from "@/components/daily/DestinationCard";
import { fetchServe } from "./serveClient";

/**
 * Today's one Ways to Serve suggestion on the Today screen, linking to
 * /serve. Renders nothing while loading, on any failure, or when the reader
 * turned Ways to Serve off (the server then sends `today: null`), so it never
 * nags someone who said no.
 */
export default function ServeTodayCard() {
	const { userId } = useAuth();
	const [today, setToday] = useState<{ title: string; reference: string } | null>(null);

	useEffect(() => {
		setToday(null);
		if (!userId) return;
		const controller = new AbortController();
		fetchServe(controller.signal)
			.then((view) => {
				if (controller.signal.aborted) return;
				setToday(view.today ? { title: view.today.title, reference: view.today.verse.reference } : null);
			})
			.catch(() => {
				// Ways to Serve stays reachable from Settings and the sidebar.
			});
		return () => controller.abort();
	}, [userId]);

	if (!today) return null;
	return (
		<DestinationCard
			href="/serve"
			title="Ways to Serve"
			description={`${today.title} · ${today.reference}`}
			Icon={HandHeart}
		/>
	);
}
