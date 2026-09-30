"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = ["3", "2", "1", "GO"];
const STEP_MS = 600;

export function Countdown({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const id = setTimeout(() => (step + 1 < STEPS.length ? setStep(step + 1) : done.current()), step === STEPS.length - 1 ? 400 : STEP_MS);
    return () => clearTimeout(id);
  }, [step]);

  return (
    <div className="flex flex-1 items-center justify-center" aria-live="assertive">
      <span
        key={step}
        className={`animate-pop font-mono font-black tabular-nums ${STEPS[step] === "GO" ? "text-8xl text-accent" : "text-9xl"}`}
      >
        {STEPS[step]}
      </span>
    </div>
  );
}
