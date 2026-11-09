import { useEffect, useRef, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A − / + button that steps once on press and keeps stepping while held, faster after a moment, the way a
 * treadmill's buttons work. Keyboard activation steps once.
 *
 * The button is named by hidden text, not aria-label: an aria-label like "More weight" would also be found by a
 * label lookup for the field ("Weight"), and those must find only the input.
 */
export function StepButton({
  direction,
  onStep,
  children,
  className,
  disabled,
}: {
  direction: "down" | "up";
  onStep: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const timer = useRef<number | null>(null);
  const pointerStep = useRef(false);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const repeat = (delay: number) => {
    timer.current = window.setTimeout(() => {
      onStepRef.current();
      repeat(Math.max(45, delay * 0.82));
    }, delay);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        pointerStep.current = true;
        onStepRef.current();
        repeat(420);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // A pointer press already stepped on pointerdown. A click with no pointer press is the keyboard.
        if (pointerStep.current) {
          pointerStep.current = false;
          return;
        }
        onStepRef.current();
      }}
      className={cn(
        "press grid h-12 w-12 shrink-0 touch-manipulation select-none place-items-center rounded-full border border-line bg-white/[0.05] text-chalk",
        "hover:border-line-strong hover:bg-white/[0.1] disabled:opacity-40",
        className,
      )}>
      {direction === "down" ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      <span className="sr-only">{children}</span>
    </button>
  );
}

/** Adds `step` to a typed number and rounds away float noise, so 0.1 + 0.2 shows as 0.3. */
export function stepValue(current: string, step: number, { min = 0, start }: { min?: number; start?: number } = {}) {
  const parsed = parseFloat(current);
  const base = Number.isFinite(parsed) ? parsed : start !== undefined ? start - step : 0;
  const next = Math.max(min, Math.round((base + step) * 100) / 100);
  return String(next);
}
