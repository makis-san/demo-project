import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

type Pane = { id: string; label: string; badge?: ReactNode; content: ReactNode };

/**
 * Two or more panes side by side that a phone swipes between, with tabs above them. The swipe is the browser's own
 * horizontal scroll with snap points, so it has native momentum and needs no gesture code. The tab indicator follows
 * the finger as the panes move, and a tap on a tab glides to its pane.
 *
 * From `lg` up the tabs are gone and the panes sit next to each other as columns (`desktopClassName`).
 *
 * The panes are as tall as the one in view: the others are cut to its height, so the page doesn't end in empty space
 * under a short pane. Switching to a pane that starts above the screen scrolls back up to the tabs.
 */
export function SwipePanes({
  panes,
  label,
  desktopClassName,
  controller,
}: {
  panes: Pane[];
  label: string;
  desktopClassName?: string;
  /** Filled with a function that shows a pane, for the page to switch panes itself. */
  controller?: RefObject<((index: number) => void) | null>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  // Where the panes are, from 0 (the first) to panes.length - 1, with fractions while they move.
  const [position, setPosition] = useState(0);
  const [active, setActive] = useState(0);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const paneRefs = useRef<(HTMLElement | null)[]>([]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const next = el.scrollLeft / el.clientWidth;
    setPosition(next);
    const settled = Math.round(next);
    if (Math.abs(next - settled) < 0.02) setActive(settled);
  }, []);

  // The visible pane's height sets the height of all of them, and follows it as its content changes.
  useEffect(() => {
    const pane = paneRefs.current[active];
    if (!pane) return;
    const measure = () => setActiveHeight(pane.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [active]);

  const goTo = useCallback((index: number) => {
    const el = scroller.current;
    // From lg up the panes are columns and nothing scrolls sideways.
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
    setActive(index);
    const top = tabs.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) tabs.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  if (controller) controller.current = goTo;

  return (
    <div>
      <div
        ref={tabs}
        role="tablist"
        aria-label={label}
        className="relative mb-4 grid scroll-mt-4 rounded-full bg-black/25 p-1 lg:hidden [@media(max-height:700px)]:mb-2"
        style={{ gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 rounded-full will-change-transform bg-white/[0.1] shadow-[inset_0_0_0_1px_oklch(100%_0_0/0.08)]"
          style={{
            width: `calc((100% - 0.5rem) / ${panes.length})`,
            transform: `translateX(${position * 100}%)`,
          }}
        />
        {panes.map((pane, i) => (
          <button
            key={pane.id}
            type="button"
            role="tab"
            id={`${pane.id}-tab`}
            aria-selected={active === i}
            aria-controls={`${pane.id}-pane`}
            onClick={() => goTo(i)}
            className={cn(
              "press relative flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors duration-300 [@media(max-height:700px)]:h-8",
              Math.round(position) === i ? "text-chalk" : "text-faint hover:text-muted",
            )}>
            {pane.label}
            {pane.badge}
          </button>
        ))}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          "swipe-panes -mx-4 flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain md:-mx-2",
          "lg:mx-0 lg:overflow-visible",
          desktopClassName,
        )}>
        {panes.map((pane, i) => (
          <section
            key={pane.id}
            ref={(el) => {
              paneRefs.current[i] = el;
            }}
            id={`${pane.id}-pane`}
            role="tabpanel"
            aria-labelledby={`${pane.id}-tab`}
            className={cn(
              "w-full min-w-0 shrink-0 snap-start snap-always px-4 md:px-2 lg:w-auto lg:shrink lg:px-0",
              // Cut to the visible pane's height on a phone. On a desktop every pane shows in full.
              i !== active && activeHeight !== null && "max-lg:max-h-(--pane-cap) max-lg:overflow-hidden",
            )}
            style={{ "--pane-cap": `${activeHeight ?? 0}px` } as React.CSSProperties}>
            {pane.content}
          </section>
        ))}
      </div>
    </div>
  );
}
