import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createMovementServerFn } from "@/lib/movements.server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { movementsQueryOptions } from "./-queries/movements";
import { Plus } from "lucide-react";
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

  const createMovementMutation = useMutation({
    mutationFn: async (input: { name: string; isBodyWeight: boolean }) => {
      const result = await createMovementServerFn({ data: input });
      // The router shows a toast for any error thrown from a mutation.
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: movementsQueryOptions().queryKey });
      setName("");
      setIsBodyWeight(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMovementMutation.mutate({ name: name.trim(), isBodyWeight });
  };

  const bodyWeightCount = movements.filter((m) => m.isBodyWeight).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Library" title="Movements" />

      <Card className="enter enter-1">
        <CardHeader>
          <p className="eyebrow">New</p>
          <CardTitle>Add New Movement</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Movement name"
                placeholder="Movement name (e.g. Bench Press)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="sm:flex-1"
              />
              <Button type="submit" disabled={!name.trim()} className="h-12 sm:px-7">
                <Plus className="h-4 w-4" />
                {createMovementMutation.isPending ? "Adding..." : "Add"}
              </Button>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl px-1 text-sm text-muted">
              <input
                type="checkbox"
                checked={isBodyWeight}
                onChange={(e) => setIsBodyWeight(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
              />
              Body-weight movement (like pull-ups or dips). The weight starts at your body weight.
            </label>
          </form>
        </CardContent>
      </Card>
      <Card className="enter enter-2">
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <p className="eyebrow">Your list</p>
            <CardTitle>All Movements</CardTitle>
          </div>
          {movements.length > 0 && (
            <p className="num text-sm text-muted">
              <span className="font-semibold text-chalk">{movements.length}</span> total
              {bodyWeightCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-chalk">{bodyWeightCount}</span> body weight
                </>
              )}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
              No movements yet. Add one above!
            </p>
          ) : (
            <ul className="setlist grid gap-1.5 sm:grid-cols-2">
              {movements.map((movement) => (
                <li
                  key={movement.id}
                  className="flex min-w-0 items-center gap-3 rounded-2xl bg-well px-4 py-3.5 text-[15px] font-medium text-chalk transition-colors hover:bg-white/[0.07]">
                  <span className="min-w-0 flex-1 truncate">{movement.name}</span>
                  {movement.isBodyWeight && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary">
                      Body weight
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
