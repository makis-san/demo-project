import { useState } from "react";
import { Morph } from "@/components/morph";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createMovementServerFn } from "@/lib/movements.server";
import { Card } from "@/components/ui/card";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { movementsQueryOptions } from "./-queries/movements";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/__index/_layout/movements/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(movementsQueryOptions());
  },
  component: MovementsPage,
});

function MovementsPage() {
  const queryClient = useQueryClient();
  const { data: movements } = useSuspenseQuery(movementsQueryOptions());
  const [name, setName] = useState("");
  const [isBodyWeight, setIsBodyWeight] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // The movement just added, so it can be lit for a moment where it landed in the list.
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const createMovementMutation = useMutation({
    mutationFn: async (input: { name: string; isBodyWeight: boolean }) => {
      const result = await createMovementServerFn({ data: input });
      // The router shows a toast for any error thrown from a mutation.
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: movementsQueryOptions().queryKey });
      setName("");
      setIsBodyWeight(false);
      setFilter("all");
      setJustAdded(input.name.toLowerCase());
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMovementMutation.mutate({ name: name.trim(), isBodyWeight });
  };

  // One field both finds and adds: what you type filters the list, and Add saves it when it's new.
  const query = name.trim().toLowerCase();
  const counts = {
    all: movements.length,
    weighted: movements.filter((m) => !m.isBodyWeight).length,
    bodyWeight: movements.filter((m) => m.isBodyWeight).length,
  };
  const shown = movements.filter(
    (m) =>
      (filter === "all" || (filter === "bodyWeight") === m.isBodyWeight) &&
      (!query || m.name.toLowerCase().includes(query)),
  );
  const exists = movements.some((m) => m.name.toLowerCase() === query);

  // Runs of the same first letter, in the order the server sorted them, like a phone's contact list.
  const groups: { letter: string; items: typeof shown }[] = [];
  for (const movement of shown) {
    const letter = /[a-z]/i.test(movement.name[0]) ? movement.name[0].toUpperCase() : "#";
    const last = groups[groups.length - 1];
    if (last?.letter === letter) last.items.push(movement);
    else groups.push({ letter, items: [movement] });
  }

  let status = "";
  if (query && exists) status = `${name.trim()} is already in your library.`;
  else if (query && shown.length === 0) status = `Nothing matches. Add “${name.trim()}” as a new movement.`;
  else if (query)
    status = `${shown.length} ${shown.length === 1 ? "match" : "matches"}. Add saves “${name.trim()}” as new.`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Library" title="Movements" />

      <Card className="enter enter-1 space-y-4 p-3 sm:p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-faint" />
              <Input
                aria-label="Movement name"
                placeholder="Find or add"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-14 rounded-2xl pl-12 text-base"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={!name.trim()} className="h-14 px-4 sm:px-6">
              <Plus className="h-5 w-5" />
              {createMovementMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1 text-sm text-muted">
            <input
              type="checkbox"
              checked={isBodyWeight}
              onChange={(e) => setIsBodyWeight(e.target.checked)}
              className="switch shrink-0"
            />
            <span>Body-weight movement (like pull-ups or dips). The weight starts at your body weight.</span>
          </label>
          <p className="num min-h-5 px-2 text-xs text-faint" aria-live="polite">
            {status}
          </p>
        </form>
      </Card>

      <Card className="enter enter-2 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">All Movements</h2>
          <div className="flex gap-1 rounded-full bg-black/25 p-1" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["weighted", "Weighted"],
                ["bodyWeight", "Body wt"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "press flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                  filter === key ? "bg-white/[0.12] text-chalk" : "text-faint hover:text-chalk",
                )}>
                {label}
                <span aria-hidden="true" className={filter === key ? "text-accent" : ""}>
                  <Morph value={counts[key]} />
                </span>
              </button>
            ))}
          </div>
        </div>
        {movements.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            No movements yet. Add one above!
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            No movements match.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ letter, items }) => (
              <section key={letter} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <p aria-hidden="true" className="pt-3 text-center text-lg font-bold text-accent/80 font-stretch-[120%]">
                  {letter}
                </p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {items.map((movement) => (
                    <li
                      key={movement.id}
                      className={cn(
                        "flex min-h-12 min-w-0 items-center gap-3 rounded-2xl bg-well px-4 py-3 text-[15px] font-medium text-chalk transition-colors hover:bg-white/[0.07]",
                        justAdded === movement.name.toLowerCase() && "enter ring-1 ring-primary/60",
                      )}>
                      <span className="min-w-0 flex-1 truncate">
                        <Highlight text={movement.name} query={query} />
                      </span>
                      {movement.isBodyWeight && (
                        <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
                          Body weight
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

type Filter = "all" | "weighted" | "bodyWeight";

/** The name with the searched part lit. The text stays one string, so the row still reads as the name. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[4px] bg-primary/25 px-0.5 text-chalk">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}
