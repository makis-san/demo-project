import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldLabel, FormError } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { changePasswordServerFn } from "@/lib/account-settings.server";
import { errorMessage } from "@/lib/error-message";
import { minPasswordLength } from "@/lib/validation";
import { sessionsQueryOptions } from "./-queries/account";

export function PasswordCard() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const change = useMutation({
    mutationFn: () => changePasswordServerFn({ data: { currentPassword, newPassword } }),
    onSuccess: (result) => {
      if (!result.success) return setError(result.error);
      setCurrentPassword("");
      setNewPassword("");
      setDone(
        result.signedOut === 0
          ? "Password changed."
          : `Password changed. ${result.signedOut} other ${result.signedOut === 1 ? "device was" : "devices were"} signed out.`,
      );
      // The other devices are gone from the list above.
      queryClient.invalidateQueries({ queryKey: sessionsQueryOptions().queryKey });
    },
    // The global handler shows a toast. The form also says so, since a toast goes away after a few seconds.
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Card className="enter enter-2 p-3 sm:p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setDone("");
          change.mutate();
        }}
        className="space-y-5 p-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-chalk font-stretch-[112%]">Change password</h2>
          <p className="text-sm text-muted">Every other device is signed out when you change it.</p>
        </div>
        {error && <FormError>{error}</FormError>}
        {done && (
          <p role="status" className="rounded-2xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm text-chalk">
            {done}
          </p>
        )}
        <div className="space-y-2">
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={minPasswordLength}
            maxLength={128}
            autoComplete="new-password"
          />
          <p className="text-xs text-faint">Must be at least {minPasswordLength} characters</p>
        </div>
        <Button type="submit" disabled={change.isPending} className="w-full sm:w-auto">
          {change.isPending ? "Changing..." : "Change password"}
        </Button>
      </form>
    </Card>
  );
}
