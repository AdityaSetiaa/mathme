import { Suspense } from "react";
import { CollectionScreen } from "@/features/vocabulary/CollectionScreen";

// Word details are ?w= rather than /words/[id] so this stays one static page (cacheable offline).
export default function Page() {
  return (
    <Suspense>
      <CollectionScreen />
    </Suspense>
  );
}
