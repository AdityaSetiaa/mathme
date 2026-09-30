import { Suspense } from "react";
import { HistoryScreen } from "@/features/history/HistoryScreen";

// Session detail is ?id= rather than /history/[id] so this stays one static page (cacheable offline).
export default function Page() {
  return (
    <Suspense>
      <HistoryScreen />
    </Suspense>
  );
}
