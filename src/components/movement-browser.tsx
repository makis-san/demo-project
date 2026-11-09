import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryTabs } from "@/components/category-tabs";
import { MovementCard, type MovementCardData } from "@/components/movement-card";
import { movementSearchQueryOptions } from "@/routes/__index/_layout.current-workout/-queries/current-workout";
import type { MovementCategory } from "@/lib/muscles";

type Props =
  | {
      /** Tick several movements and add them together: building a workout. */
      mode?: "multiple";
      onClose: () => void;
      onAdd: (movements: MovementCardData[]) => void;
    }
  | {
      /** Tap one movement and it is picked: adding an extra movement to the workout in progress. */
      mode: "single";
      onClose: () => void;
      onPick: (movement: MovementCardData) => void;
    };

/**
 * The movement chooser: body-part tabs, a search box, and the movements as cards. It is a **bottom sheet on a phone**
 * (it rises from the bottom edge and a thumb reaches everything) and a **centered modal on a desktop**. Escape, the close
 * button, or a tap on the dimmed page behind it closes it.
 *
 * It asks the server for a page at a time and loads the next page when the end of the list scrolls into view, so the
 * whole library is never sent at once. In "multiple" mode the cards have a checkmark, ticks stay while the tab or the
 * search changes, and Add hands them all back in the order they were ticked. In "single" mode a tap on a card picks it.
 */
export function MovementBrowser(props: Props) {
  const { onClose } = props;
  const single = props.mode === "single";
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<MovementCategory | null>(null);
  const [selected, setSelected] = useState<Map<string, MovementCardData>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // The page behind does not scroll while the chooser is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const query = useInfiniteQuery({
    ...movementSearchQueryOptions(debounced, category),
    placeholderData: keepPreviousData,
  });
  const movements = query.data?.pages.flatMap((page) => page.movements) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const end = sentinel.current;
    if (!end || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: listRef.current, rootMargin: "120px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, movements.length]);

  const toggle = (movement: MovementCardData) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(movement.id)) next.set(movement.id, movement);
      return next;
    });

  // In a portal on the body, so the page's own spacing and transforms cannot move the sheet.
  return createPortal(
    <div
      className="sheet-backdrop fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center"
      role="presentation"
      // A tap on the dimmed page, not on the sheet itself.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={single ? "Choose a movement" : "Add movements"}
        data-sheet
        className="sheet glass glass-strong flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)] sm:max-w-2xl sm:rounded-panel sm:pb-0">
        {/* The grab handle of a bottom sheet. It only shows on a phone. */}
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">
            {single ? "Choose a movement" : "Add movements"}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3 px-4 pt-3 pb-2 sm:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              role="searchbox"
              aria-label="Search movements"
              placeholder="Search movements"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              autoFocus
              className="h-12 rounded-2xl pl-10"
            />
          </div>
          <CategoryTabs value={category} onChange={setCategory} />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-5">
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2" aria-label="Movements">
            {movements.map((movement) => (
              <li key={movement.id}>
                {props.mode === "single" ? (
                  <MovementCard movement={movement} onPick={() => props.onPick(movement)} />
                ) : (
                  <MovementCard
                    movement={movement}
                    selected={selected.has(movement.id)}
                    onToggle={() => toggle(movement)}
                  />
                )}
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <div ref={sentinel} aria-hidden="true" className="py-4 text-center text-xs text-faint">
              Loading more…
            </div>
          )}
          {!query.isPending && movements.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              {debounced ? `No movement matches “${debounced}”.` : "No movements here."}
            </p>
          )}
          {query.isPending && <p className="py-10 text-center text-sm text-faint">Loading…</p>}
        </div>
        {props.mode !== "single" && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <p className="num text-sm text-muted" aria-live="polite">
              {selected.size === 0 ? "Tick the movements to add" : `${selected.size} selected`}
            </p>
            <Button disabled={selected.size === 0} onClick={() => props.onAdd([...selected.values()])}>
              {selected.size === 0 ? "Add" : `Add ${selected.size} ${selected.size === 1 ? "movement" : "movements"}`}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
