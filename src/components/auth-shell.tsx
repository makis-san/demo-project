import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

// A real session as it shows in the app, so the first screen shows the product, not a slogan.
const previewSets = [
  { movement: "Back Squat", reps: 5, weight: 225 },
  { movement: "Back Squat", reps: 5, weight: 235 },
  { movement: "Romanian Deadlift", reps: 8, weight: 185 },
  { movement: "Pull-up", reps: 10, weight: 182 },
];
const previewVolume = previewSets.reduce((sum, set) => sum + set.reps * set.weight, 0);

/** The signed-out screens: the product on the left from lg up, the form on a glass panel on the right. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:px-8">
      <section className="enter hidden lg:block" aria-hidden="true">
        <Logo />
        <p className="mt-14 max-w-xl text-[3.25rem] leading-[1.02] font-bold tracking-[-0.025em] font-stretch-[120%] text-chalk">
          Every set you lift, <span className="text-accent">in the order you lifted it.</span>
        </p>
        <div className="glass mt-12 max-w-md rounded-panel p-5">
          <div className="mb-4 flex items-baseline justify-between px-1">
            <p className="text-sm font-semibold text-muted">Tonight · Lower</p>
            <p className="num text-xs text-faint">
              {previewSets.length} sets · {previewVolume.toLocaleString("en-US")} lbs
            </p>
          </div>
          <ul className="setlist space-y-1.5">
            {previewSets.map((set, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-well px-4 py-2.5">
                <span className="flex-1 truncate text-sm font-medium text-chalk">{set.movement}</span>
                <span className="num text-sm text-muted">
                  <span className="font-semibold text-chalk">{set.reps}</span> ×{" "}
                  <span className="font-semibold text-chalk">{set.weight}</span> lbs
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="enter enter-1 mx-auto w-full max-w-md">
        <div className="mb-8 flex justify-center lg:hidden">
          <Logo />
        </div>
        <div className="glass glass-strong rounded-panel p-6 sm:p-9">
          <div className="mb-7 space-y-2">
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight font-stretch-[115%] text-chalk">
              {title}
            </h1>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-muted">
      {children}
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-chalk">
      {children}
    </div>
  );
}
