import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createMovementServerFn } from "@/lib/movements.server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { movementsQueryOptions } from "./-queries/movements";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Movements</h1>

      <Card>
        <CardHeader>
          <CardTitle>Add New Movement</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3">
              <Input
                aria-label="Movement name"
                placeholder="Movement name (e.g. Bench Press)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={!name.trim()}>
                {createMovementMutation.isPending ? "Adding..." : "Add"}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={isBodyWeight}
                onChange={(e) => setIsBodyWeight(e.target.checked)}
                className="rounded border-gray-300"
              />
              Body-weight movement (like pull-ups or dips). The weight starts at your body weight.
            </label>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>All Movements</CardTitle>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-slate-500">No movements yet. Add one above!</p>
          ) : (
            <ul className="space-y-2">
              {movements.map((movement) => (
                <li
                  key={movement.id}
                  className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-2">
                  {movement.name}
                  {movement.isBodyWeight && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
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
