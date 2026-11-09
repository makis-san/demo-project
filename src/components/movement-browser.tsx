import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryTabs } from "@/components/category-tabs";
import { MovementCard, type MovementCardData } from "@/components/movement-card";
import { MovementDetail, MovementDetailHeader } from "@/components/movement-detail";
import { Sheet } from "@/components/sheet";
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
 * and a **centered modal on a desktop**. Escape, the close button, or a tap on the dimmed page behind it closes it.
 *
 * It asks the server for a page at a time and loads the next page when the end of the list scrolls into view, so the
 * whole library is never sent at once. In "multiple" mode the cards have a checkmark, ticks stay while the tab or the
 * search changes, and Add hands them all back in the order they were ticked. In "single" mode a tap on a card picks it.
 *
 * Every card has a details button. It swaps the list for the movement's animation, muscles and steps, in the same
 * sheet, and the movement can be ticked or picked from there. Back (or Escape) returns to the list where it was: the
 * list stays mounted underneath, so the search, the tab and the scroll position are kept.
 */
export function MovementBrowser(props: Props) {
  const { onClose } = props;
  const single = props.mode === "single";
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<MovementCategory | null>(null);
  const [selected, setSelected] = useState<Map<string, MovementCardData>>(new Map());
  const [detail, setDetail] = useState<MovementCardData | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  const query = useInfiniteQuery({
    ...movementSearchQueryOptions(debounced, category),
    placeholderData: keepPreviousData,
  });
  const movements = query.data?.pages.flatMap((page) => page.movements) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const end = sentinel.current;
    if (!end || !hasNextPage || detail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: listRef.current, rootMargin: "120px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, movements.length, detail]);

  const toggle = (movement: MovementCardData) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(movement.id)) next.set(movement.id, movement);
      return next;
    });

  const title = single ? "Choose a movement" : "Add movements";

  return (
    <Sheet label={title} onEscape={() => (detail ? setDetail(null) : onClose())}>
      {detail ? (
        <MovementDetailHeader
          movement={detail}
          onBack={() => setDetail(null)}
          selected={selected.has(detail.id)}
          onToggle={props.mode === "single" ? undefined : () => toggle(detail)}
          onPick={props.mode === "single" ? () => props.onPick(detail) : undefined}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
            <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">{title}</h2>
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
        </>
      )}

      {detail && (
        <div
          key={detail.id}
          className="step-next min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 sm:px-5">
          <MovementDetail movement={detail} />
        </div>
      )}
      {/* Hidden, not unmounted, while a movement's detail is open, so coming back keeps the place in the list. */}
      <div
        ref={listRef}
        hidden={!!detail}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-5">
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2" aria-label="Movements">
          {movements.map((movement) => (
            <li key={movement.id}>
              {props.mode === "single" ? (
                <MovementCard
                  movement={movement}
                  onPick={() => props.onPick(movement)}
                  onInfo={() => setDetail(movement)}
                />
              ) : (
                <MovementCard
                  movement={movement}
                  selected={selected.has(movement.id)}
                  onToggle={() => toggle(movement)}
                  onInfo={() => setDetail(movement)}
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
    </Sheet>
  );
}
