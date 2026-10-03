import Link from "next/link";
import type { ReactNode } from "react";

export function Screen({ title, back = "/", action, children }: { title?: string; back?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      {title && (
        <header className="mb-5 flex items-center gap-2">
          <Link
            href={back}
            aria-label="Back"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-muted active:bg-line"
          >
            ←
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
          {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
        </header>
      )}
      {children}
    </div>
  );
}
