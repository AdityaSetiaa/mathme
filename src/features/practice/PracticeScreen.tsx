"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Screen } from "@/components/layout/Screen";
import { fmtSecs } from "@/components/ui";
import { DIFFICULTY_INFO, isDifficulty, isMode, MODE_INFO, type Difficulty, type Mode, type Problem } from "@/features/problems/catalog";
import { GENERATOR_VERSION, generateProblem } from "@/features/problems/generators";
import { describeError, isCorrect, parseInput } from "@/features/problems/grading";
import { summarize } from "@/features/stats/aggregate";
import { SummaryGrid } from "@/features/stats/SummaryGrid";
import { newId, putAttempt, putSession } from "@/lib/db";
import type { Attempt, Session } from "@/types/models";
import { Countdown } from "./Countdown";
import { fastPress, ghostClickGuard, Keypad, type Key } from "./Keypad";

const QUESTIONS = 20;
const MAX_INPUT = 9;

export function PracticeRoute() {
  const params = useSearchParams();
  const difficulty = params.get("difficulty");
  const mode = params.get("mode");
  if (!isDifficulty(difficulty) || !isMode(mode)) {
    return (
      <Screen title="Practice">
        <p className="text-muted">
          Unknown practice settings. <Link href="/start" className="text-accent underline">Pick again</Link>
        </p>
      </Screen>
    );
  }
  return (
    <div {...ghostClickGuard} className="contents">
      <PracticeScreen key={`${difficulty}-${mode}`} difficulty={difficulty} mode={mode} />
    </div>
  );
}

type Phase = "ready" | "countdown" | "question" | "result" | "summary";

function PracticeScreen({ difficulty, mode }: { difficulty: Difficulty; mode: Mode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [session, setSession] = useState<Session | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const backspaces = useRef(0);
  const shownAt = useRef(0);

  // Timing source of truth: performance.now() (monotonic, sub-ms) at the frame the problem is painted,
  // and again inside the submit handler. Render timers are display only.
  useLayoutEffect(() => {
    if (phase !== "question") return;
    const id = requestAnimationFrame(() => (shownAt.current = performance.now()));
    return () => cancelAnimationFrame(id);
  }, [phase, problem]);

  const save = (p: Promise<unknown>) => p.catch((err) => (console.error("Save failed", err), setSaveFailed(true)));

  function begin() {
    const s: Session = { id: newId(), mode, difficulty, plannedCount: QUESTIONS, startedAt: Date.now(), endedAt: null };
    setSession(s);
    setAttempts([]);
    save(putSession(s));
    setPhase("countdown");
  }

  function nextProblem() {
    let p = generateProblem(mode, difficulty);
    if (p.prompt === problem?.prompt) p = generateProblem(mode, difficulty); // avoid an immediate repeat
    setProblem(p);
    setInput("");
    backspaces.current = 0;
    setPhase("question");
  }

  function press(k: Key) {
    if (phase !== "question") return;
    if (k === "back") {
      if (input) backspaces.current++;
      setInput(input.slice(0, -1));
    } else if (k === "sign") {
      setInput(input.startsWith("-") ? input.slice(1) : `-${input}`);
    } else if (input.replace("-", "").length < MAX_INPUT) {
      setInput(input + k);
    }
  }

  function submit() {
    if (phase !== "question" || !problem || !session || parseInput(input) === null) return;
    const responseTimeMs = performance.now() - shownAt.current;
    const attempt: Attempt = {
      id: newId(),
      sessionId: session.id,
      index: attempts.length,
      category: problem.category,
      skill: problem.skill,
      difficulty: problem.difficulty,
      prompt: problem.prompt,
      features: problem.features,
      correctAnswer: problem.answer,
      tolerance: problem.tolerance,
      userInput: input,
      isCorrect: isCorrect(problem, input),
      responseTimeMs,
      backspaces: backspaces.current,
      createdAt: Date.now(),
      generatorVersion: GENERATOR_VERSION,
    };
    setAttempts([...attempts, attempt]);
    save(putAttempt(attempt));
    setPhase("result");
  }

  function next() {
    if (phase !== "result" || !session) return;
    if (attempts.length < session.plannedCount) return nextProblem();
    const done = { ...session, endedAt: Date.now() };
    setSession(done);
    save(putSession(done));
    setPhase("summary");
  }

  // Hardware keyboard support for desktop. No <input> exists, so the mobile keyboard never opens.
  const handlers = useRef({ press, submit, next, begin });
  useEffect(() => {
    handlers.current = { press, submit, next, begin };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const h = handlers.current;
      if (/^\d$/.test(e.key)) h.press(e.key as Key);
      else if (e.key === "-") h.press("sign");
      else if (e.key === "Backspace") h.press("back");
      else if (e.key === "Enter") {
        e.preventDefault();
        if (phase === "ready") h.begin();
        else if (phase === "question") h.submit();
        else if (phase === "result") h.next();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const info = `${MODE_INFO[mode].label} · ${DIFFICULTY_INFO[difficulty].label}`;

  if (phase === "ready")
    return (
      <Screen title=" " back={`/start/${difficulty}`}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="text-6xl" aria-hidden>
            {MODE_INFO[mode].emoji}
          </span>
          <h1 className="text-3xl font-bold">{MODE_INFO[mode].label}</h1>
          <p className="text-lg text-muted">
            {DIFFICULTY_INFO[difficulty].label} · {QUESTIONS} questions
          </p>
        </div>
        <button
          {...fastPress(begin)}
          className="h-20 rounded-3xl bg-accent text-xl font-bold tracking-wide text-accent-ink active:scale-[0.98]"
        >
          START CALCULATING
        </button>
      </Screen>
    );

  if (phase === "countdown")
    return (
      <Screen>
        <Countdown onDone={nextProblem} />
      </Screen>
    );

  if (phase === "summary" || !problem)
    return (
      <Screen title="Session complete">
        <p className="mb-4 text-muted">{info}</p>
        <SummaryGrid s={summarize(attempts)} />
        {saveFailed && <SaveWarning />}
        <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
          <Link href={`/history?id=${session?.id}`} className="flex h-14 items-center justify-center rounded-2xl border border-line bg-card font-semibold">
            Review answers
          </Link>
          <button {...fastPress(begin)} className="h-14 rounded-2xl bg-accent font-bold text-accent-ink">
            Again
          </button>
          <button onClick={() => router.push("/")} className="col-span-2 h-12 rounded-2xl text-muted">
            Home
          </button>
        </div>
      </Screen>
    );

  const last = attempts.at(-1);
  const showResult = phase === "result" && last;
  return (
    <Screen>
      <div className="flex items-center justify-between text-sm text-muted tabular-nums">
        <Link href="/" aria-label="Quit session" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-xl active:bg-line">
          ✕
        </Link>
        <span>
          {attempts.length + (phase === "question" ? 1 : 0)} / {session?.plannedCount}
        </span>
        <LiveTimer startRef={shownAt} running={phase === "question"} />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
        <p className={`font-semibold tabular-nums ${problem.prompt.length > 24 ? "text-2xl" : "text-5xl"}`}>{problem.prompt}</p>
        <p
          className={`min-h-14 font-mono text-5xl font-bold tabular-nums ${
            showResult ? (last.isCorrect ? "text-good" : "text-bad") : input ? "" : "text-line"
          }`}
          aria-live="polite"
        >
          {(showResult ? last.userInput : input).replace("-", "−") || "?"}
        </p>
      </div>

      {showResult ? <Result attempt={last} onNext={next} saveFailed={saveFailed} /> : <Keypad onKey={press} onSubmit={submit} canSubmit={parseInput(input) !== null} />}
    </Screen>
  );
}

function Result({ attempt: a, onNext, saveFailed }: { attempt: Attempt; onNext: () => void; saveFailed: boolean }) {
  const err = describeError(a.category, a.correctAnswer, a.userInput);
  const rows: [string, string][] = [
    ["Your answer", a.userInput.replace("-", "−")],
    ["Correct answer", String(a.correctAnswer).replace("-", "−")],
  ];
  if (err) {
    rows.push(["Difference", `${err.difference} too ${err.direction}`]);
    if (err.percentOff !== null) rows.push(["Off by", `${err.percentOff.toFixed(1)}%`]);
  }
  if (a.tolerance) rows.push(["Accepted within", `±${Math.round(a.tolerance * 100)}%`]);
  rows.push(["Time", fmtSecs(a.responseTimeMs)]);
  const note = err?.transposed ? "Right digits, wrong order" : err?.placeValue ? "Off by a factor of 10" : err?.signFlip ? "Wrong sign" : null;

  return (
    <div className="animate-rise flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className={`mb-2 text-xl font-bold ${a.isCorrect ? "text-good" : "text-bad"}`}>{a.isCorrect ? "✓ Correct" : "✗ Incorrect"}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-mono tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {note && <p className="mt-2 text-sm text-muted">{note}</p>}
        {saveFailed && <SaveWarning />}
      </div>
      <button {...fastPress(onNext)} autoFocus className="h-16 rounded-2xl bg-accent text-lg font-bold tracking-wide text-accent-ink active:scale-[0.98]">
        NEXT
      </button>
    </div>
  );
}

function SaveWarning() {
  return <p className="mt-2 text-sm text-bad">⚠ Couldn’t save to this device. This session may not appear in your history.</p>;
}

// Display only: writes straight to the DOM each frame so the practice screen doesn't re-render 60×/s.
function LiveTimer({ startRef, running }: { startRef: RefObject<number>; running: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!running) return;
    let id = requestAnimationFrame(function tick() {
      if (el.current && startRef.current) el.current.textContent = `${((performance.now() - startRef.current) / 1000).toFixed(1)}s`;
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [running, startRef]);
  return (
    <span ref={el} className="w-14 text-right font-mono" aria-hidden>
      0.0s
    </span>
  );
}
