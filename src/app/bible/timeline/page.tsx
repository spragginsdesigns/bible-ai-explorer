import { Suspense } from "react";
import AtlasScreen from "@/components/atlas/AtlasScreen";

export default function BibleTimelinePage() {
  return (
    <Suspense>
      <AtlasScreen />
    </Suspense>
  );
}
