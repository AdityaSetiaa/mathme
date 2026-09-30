import { notFound } from "next/navigation";
import { DIFFICULTIES, isDifficulty } from "@/features/problems/catalog";
import { CategoryGrid } from "@/features/start/CategoryGrid";

// Prerender all four so they work offline from the service worker cache.
export const dynamicParams = false;
export const generateStaticParams = () => DIFFICULTIES.map((difficulty) => ({ difficulty }));

export default async function Page({ params }: PageProps<"/start/[difficulty]">) {
  const { difficulty } = await params;
  if (!isDifficulty(difficulty)) notFound();
  return <CategoryGrid difficulty={difficulty} />;
}
