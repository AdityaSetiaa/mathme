import { Suspense } from "react";
import { PracticeRoute } from "@/features/practice/PracticeScreen";

// Settings come from ?difficulty=&mode= so this stays one static page (cacheable offline).
export default function Page() {
  return (
    <Suspense>
      <PracticeRoute />
    </Suspense>
  );
}
