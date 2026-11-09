import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell, FieldLabel, FormError } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAccountServerFn } from "@/lib/auth.server";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/create-account")({
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/" });
    }
  },
  component: CreateAccountPage,
});

function CreateAccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await createAccountServerFn({ data: { email, name, password } });
      if (result.success) {
        router.navigate({ to: "/" });
      } else {
        setError(result.error || "Account creation failed");
      }
    } catch (error) {
      console.error("Error creating account", error);
      setError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell title="Create account">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <FormError>{error}</FormError>}
        <div className="space-y-2">
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
          />
          <p className="text-xs text-faint">Must be at least 6 characters</p>
        </div>
        <Button type="submit" className="h-12 w-full" disabled={isLoading}>
          {isLoading ? "Creating account..." : "Create account"}
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/sign-in" className="font-semibold text-accent underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
