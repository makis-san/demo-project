import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { buzz } from "@/lib/use-now";

/** How long each step is on the screen, in milliseconds. The last one is "GO!". */
const steps = [
  { label: "3", ms: 750 },
  { label: "2", ms: 750 },
  { label: "1", ms: 750 },
  { label: "GO!", ms: 550 },
] as const;

/** True for someone who asked their system for less motion. They start at once, with no countdown. */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 3, 2, 1, GO before a workout begins. It covers the screen, each number pops in and fades, and the phone ticks on
 * each one and buzzes at GO. The workout is created only when `onDone` runs, after GO, so the clock starts at GO. Cancel,
 * or Escape, stops it and nothing has been created.
 */
export function StartCountdown({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const done = useRef(onDone);
  const cancel = useRef(onCancel);
  done.current = onDone;
  cancel.current = onCancel;

  useEffect(() => {
    if (step === steps.length - 1) buzz([40, 60, 40]);
    else buzz(15);
    const id = window.setTimeout(() => {
      if (step === steps.length - 1) done.current();
      else setStep(step + 1);
    }, steps[step].ms);
    return () => window.clearTimeout(id);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancel.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const current = steps[step];
  const go = step === steps.length - 1;

  // In a portal on the body: a full-screen cover must not sit inside the page's own layout, where spacing and
  // transforms of the parents would move it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Starting the workout"
      data-testid="countdown"
      data-step={current.label}
      className="sheet-backdrop fixed inset-0 z-[60] grid place-items-center bg-ground/90 backdrop-blur-md">
      <p className="eyebrow absolute top-[18%] text-accent">{go ? "Let's lift" : "Get ready"}</p>
      <p
        key={step}
        aria-live="assertive"
        className={`count-pop num font-bold tracking-tight font-stretch-[85%] select-none ${
          go ? "text-primary text-[26vw] sm:text-[12rem]" : "text-chalk text-[40vw] sm:text-[16rem]"
        }`}>
        {current.label}
      </p>
      <Button variant="ghost" onClick={() => cancel.current()} className="absolute bottom-[12%]">
        Cancel
      </Button>
    </div>,
    document.body,
  );
}
