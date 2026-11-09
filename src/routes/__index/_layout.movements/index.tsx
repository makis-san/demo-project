import { useState } from "react";
import { Morph } from "@/components/morph";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createMovementServerFn } from "@/lib/movements.server";
import { Card } from "@/components/ui/card";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { movementsQueryKey, movementsQueryOptions } from "./-queries/movements";
import { ChevronRight, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MusclePicker, type MuscleSelection } from "@/components/muscle-picker";
import {
  equipmentLabels,
  equipmentTypes,
  muscleGroups,
  muscleLabels,
  type Equipment,
  type MuscleGroup,
} from "@/lib/muscles";

export const Route = createFileRoute("/__index/_layout/movements/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(movementsQueryOptions());
  },
  component: MovementsPage,
});

type Filter = "all" | "weighted" | "bodyWeight";

function MovementsPage() {
  const queryClient = useQueryClient();
  const { data: movements } = useSuspenseQuery(movementsQueryOptions());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [muscle, setMuscle] = useState<MuscleGroup | "">("");
  const [equipment, setEquipment] = useState<Equipment | "">("");
  const [mineOnly, setMineOnly] = useState(false);

  // The form for a custom movement.
  const [name, setName] = useState("");
  const [isBodyWeight, setIsBodyWeight] = useState(false);
  const [newEquipment, setNewEquipment] = useState<Equipment | "">("");
  const [muscles, setMuscles] = useState<MuscleSelection>({ primary: [], secondary: [] });
  // The movement just added, so it can be lit for a moment where it landed in the list.
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const createMovementMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      isBodyWeight: boolean;
      equipment: Equipment | null;
      primaryMuscles: MuscleGroup[];
      secondaryMuscles: MuscleGroup[];
    }) => {
      const result = await createMovementServerFn({ data: input });
      // The router shows a toast for any error thrown from a mutation.
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: movementsQueryKey });
      setName("");
      setIsBodyWeight(false);
      setNewEquipment("");
      setMuscles({ primary: [], secondary: [] });
      setSearch("");
      setFilter("all");
      setMuscle("");
      setEquipment("");
      setMineOnly(false);
      setJustAdded(input.name.toLowerCase());
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMovementMutation.mutate({
      name: name.trim(),
      isBodyWeight,
      equipment: newEquipment || null,
      primaryMuscles: muscles.primary,
      secondaryMuscles: muscles.secondary,
    });
  };

  const query = search.trim().toLowerCase();
  const counts = {
    all: movements.length,
    weighted: movements.filter((m) => !m.isBodyWeight).length,
    bodyWeight: movements.filter((m) => m.isBodyWeight).length,
  };
  const mineCount = movements.filter((m) => !m.isBuiltIn).length;
  const shown = movements.filter(
    (m) =>
      (filter === "all" || (filter === "bodyWeight") === m.isBodyWeight) &&
      (!muscle || m.primaryMuscles.includes(muscle) || m.secondaryMuscles.includes(muscle)) &&
      (!equipment || m.equipment === equipment) &&
      (!mineOnly || !m.isBuiltIn) &&
      (!query || m.name.toLowerCase().includes(query)),
  );
  const filtering = !!(query || muscle || equipment || mineOnly || filter !== "all");

  // The name typed in the form is taken: say so before the server has to.
  const typed = name.trim().toLowerCase();
  const taken = typed ? movements.find((m) => m.name.toLowerCase() === typed) : undefined;

  // Runs of the same first letter, in the order the server sorted them, like a phone's contact list.
  const groups: { letter: string; items: typeof shown }[] = [];
  for (const movement of shown) {
    const letter = /[a-z]/i.test(movement.name[0]) ? movement.name[0].toUpperCase() : "#";
    const last = groups[groups.length - 1];
    if (last?.letter === letter) last.items.push(movement);
    else groups.push({ letter, items: [movement] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Movements"
        actions={
          <a href="#create-movement" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
            Create your own
          </a>
        }
      />

      <Card className="enter enter-1 space-y-3 p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-faint" />
          <Input
            aria-label="Search movements"
            placeholder="Search the library"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-14 rounded-2xl pl-12 text-base"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            aria-label="Filter by muscle"
            value={muscle}
            onChange={(e) => setMuscle(e.target.value as MuscleGroup | "")}>
            <option value="">Any muscle</option>
            {muscleGroups.map((m) => (
              <option key={m} value={m}>
                {muscleLabels[m]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by equipment"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value as Equipment | "")}>
            <option value="">Any equipment</option>
            {equipmentTypes.map((e) => (
              <option key={e} value={e}>
                {equipmentLabels[e]}
              </option>
            ))}
          </Select>
        </div>
        <p className="num min-h-5 px-2 text-xs text-faint" aria-live="polite">
          {filtering
            ? shown.length === 0
              ? "Nothing matches. Clear a filter, or create your own below."
              : `${shown.length} of ${movements.length} movements`
            : `${movements.length} movements`}
        </p>
      </Card>

      <Card className="enter enter-2 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Library</h2>
          <div className="flex flex-wrap gap-1 rounded-3xl bg-black/25 p-1" role="group" aria-label="Show">
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
            <button
              type="button"
              aria-pressed={mineOnly}
              onClick={() => setMineOnly((v) => !v)}
              className={cn(
                "press flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                mineOnly ? "bg-white/[0.12] text-chalk" : "text-faint hover:text-chalk",
              )}>
              Mine
              <span aria-hidden="true" className={mineOnly ? "text-accent" : ""}>
                <Morph value={mineCount} />
              </span>
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            {mineOnly && mineCount === 0 && !query && !muscle && !equipment
              ? "You haven't created any movements. The library has plenty to start with."
              : "No movements match."}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ letter, items }) => (
              <section key={letter} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2">
                <p aria-hidden="true" className="pt-3 text-center text-lg font-bold text-accent/80 font-stretch-[120%]">
                  {letter}
                </p>
                <ul className="grid gap-1.5 sm:grid-cols-2" aria-label={`Movements starting with ${letter}`}>
                  {items.map((movement) => (
                    <li
                      key={movement.id}
                      className={cn(
                        "relative flex min-h-14 min-w-0 items-center gap-3 rounded-2xl bg-well px-4 py-2.5 transition-colors hover:bg-white/[0.07]",
                        justAdded === movement.name.toLowerCase() && "enter ring-1 ring-primary/60",
                      )}>
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/movements/$movementId"
                          params={{ movementId: movement.id }}
                          className="block truncate text-[15px] font-medium text-chalk after:absolute after:inset-0 after:rounded-2xl">
                          <Highlight text={movement.name} query={query} />
                        </Link>
                        <p className="truncate text-xs text-faint">
                          {[
                            movement.equipment && equipmentLabels[movement.equipment],
                            movement.primaryMuscles.map((m) => muscleLabels[m]).join(", "),
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No muscles set"}
                        </p>
                      </div>
                      {!movement.isBuiltIn && (
                        <span className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted">
                          Yours
                        </span>
                      )}
                      {movement.isBodyWeight && (
                        <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
                          Body weight
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card id="create-movement" className="enter enter-3 scroll-mt-6 p-3 sm:p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1 px-2 pt-2">
            <p className="eyebrow">Not in the library?</p>
            <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">
              Create your own movement
            </h2>
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="Movement name"
              placeholder="Name, for example Cable Y-Raise"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-14 min-w-0 flex-1 rounded-2xl text-base"
              autoComplete="off"
            />
            <Button type="submit" disabled={!name.trim()} className="h-14 px-4 sm:px-6">
              <Plus className="h-5 w-5" />
              {createMovementMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
          <p className="min-h-5 px-2 text-xs text-faint" aria-live="polite">
            {taken
              ? taken.isBuiltIn
                ? `${taken.name} is already in the library.`
                : `You already have ${taken.name}.`
              : ""}
          </p>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1 text-sm text-muted">
            <input
              type="checkbox"
              checked={isBodyWeight}
              onChange={(e) => setIsBodyWeight(e.target.checked)}
              className="switch shrink-0"
            />
            <span>Body-weight movement (like pull-ups or dips). The weight starts at your body weight.</span>
          </label>
          <div className="px-2">
            <Select
              aria-label="Equipment for the new movement"
              value={newEquipment}
              onChange={(e) => setNewEquipment(e.target.value as Equipment | "")}>
              <option value="">Equipment (optional)</option>
              {equipmentTypes.map((e) => (
                <option key={e} value={e}>
                  {equipmentLabels[e]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 px-2">
            <p className="eyebrow">Muscles (optional)</p>
            <MusclePicker value={muscles} onChange={setMuscles} />
          </div>
        </form>
      </Card>
    </div>
  );
}

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
