import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Search } from "lucide-react";
import { movementSearchQueryOptions } from "@/routes/__index/_layout.current-workout/-queries/current-workout";
import { equipmentLabels, muscleLabels } from "@/lib/muscles";
import { cn } from "@/lib/utils";

/** What the workout needs to know about the movement it is logging. */
export type MovementOption = { id: string; name: string; isBodyWeight: boolean };

/**
 * The movement menu of the set form: a button that opens a search box and a list.
 *
 * - Filtering is done by the server (`searchMovementsServerFn`), with a short pause after the last key so typing
 *   does not send a request per letter.
 * - The list is loaded a page at a time. Nothing is requested until the menu is opened, and the next page is
 *   requested when the end of the list scrolls into view, so the whole library is never sent at once.
 * - It is a combobox: the search box keeps focus, ArrowUp and ArrowDown move through the options, Enter picks one,
 *   Escape closes it.
 */
export function MovementPicker({
  value,
  onChange,
  hint,
}: {
  value: MovementOption | null;
  onChange: (movement: MovementOption) => void;
  /** The line under the name, for example the last top set. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const listId = useId();

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 200);
    return () => window.clearTimeout(id);
  }, [search]);

  const query = useInfiniteQuery({
    ...movementSearchQueryOptions(debounced),
    enabled: open,
    // Keep the old list on screen while the new search loads, so typing does not flash an empty menu.
    placeholderData: keepPreviousData,
  });
  // True from the first key until the list for the typed text has arrived, so Enter does not pick from the old list.
  const settling = search.trim() !== debounced || (query.isFetching && query.isPlaceholderData);
  const options = query.data?.pages.flatMap((page) => page.movements) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // The end of the list came into view: ask for the next page.
  useEffect(() => {
    const end = sentinel.current;
    if (!open || !end || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: listRef.current, rootMargin: "80px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [open, hasNextPage, isFetchingNextPage, fetchNextPage, options.length]);

  // A click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const pick = (movement: (typeof options)[number]) => {
    onChange({ id: movement.id, name: movement.name, isBodyWeight: movement.isBodyWeight });
    setSearch("");
    setDebounced("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!settling && options[active]) pick(options[active]);
    }
  };

  // Keep the highlighted option in view while moving with the keys.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Movement"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
        className="relative block w-full rounded-[1.25rem] border border-line bg-black/25 px-4 py-3.5 text-left transition-colors hover:border-line-strong focus-visible:border-primary focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_oklch(58%_0.215_27/0.3)]">
        <span className="eyebrow block">Movement</span>
        <span
          className={cn(
            "mt-1 block truncate pr-8 text-xl font-semibold tracking-tight font-stretch-[108%]",
            value ? "text-chalk" : "text-faint",
          )}>
          {value?.name ?? "Choose a movement"}
        </span>
        <span className="num mt-0.5 block min-h-4 truncate pr-8 text-xs text-muted">{hint}</span>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute top-1/2 right-4 h-5 w-5 -translate-y-1/2 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="glass glass-strong absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[1.25rem]">
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              type="text"
              role="searchbox"
              aria-label="Search movements"
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${options[active].id}` : undefined}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search movements"
              autoFocus
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-line bg-black/25 pr-3 pl-9 text-[15px] text-chalk placeholder:text-faint focus-visible:border-primary focus-visible:outline-none"
            />
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Movements"
            aria-busy={settling}
            className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
            {options.map((movement, i) => (
              <li
                key={movement.id}
                id={`${listId}-${movement.id}`}
                role="option"
                aria-selected={movement.id === value?.id}
                data-index={i}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => pick(movement)}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2",
                  i === active && "bg-white/[0.09]",
                  movement.id === value?.id && "shadow-[inset_3px_0_0_var(--color-primary)]",
                )}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-chalk">{movement.name}</span>
                  <span className="block truncate text-xs text-faint">
                    {[
                      movement.equipment && equipmentLabels[movement.equipment],
                      movement.primaryMuscles.map((m) => muscleLabels[m]).join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {!movement.isBuiltIn && (
                  <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-semibold text-muted">
                    Yours
                  </span>
                )}
              </li>
            ))}
            {hasNextPage && (
              <li ref={sentinel} aria-hidden="true" className="px-3 py-3 text-center text-xs text-faint">
                Loading more…
              </li>
            )}
            {!query.isPending && options.length === 0 && (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-muted">
                {debounced ? `No movement matches “${debounced}”.` : "No movements yet."}
              </li>
            )}
            {query.isPending && (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-faint">
                Loading…
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
