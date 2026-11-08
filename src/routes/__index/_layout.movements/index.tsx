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

  const createMovementMutation = useMutation({
    mutationFn: async (name: string) => {
      const result = await createMovementServerFn({ data: { name } });
      // The router shows a toast for any error thrown from a mutation.
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: movementsQueryOptions().queryKey });
      setName("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMovementMutation.mutate(name.trim());
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Movements</h1>

      <Card>
        <CardHeader>
          <CardTitle>Add New Movement</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              placeholder="Movement name (e.g. Bench Press)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!name.trim()}>
              {createMovementMutation.isPending ? "Adding..." : "Add"}
            </Button>
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
                <li key={movement.id} className="px-3 py-2 bg-slate-50 rounded-lg text-sm font-medium text-slate-700">
                  {movement.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
