import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { registerMerchant, signInUserFn, getCurrentUserFn } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — JevishPay M-Pesa API" },
      {
        name: "description",
        content:
          "Sign in or create a JevishPay account to get an API key and start sending M-Pesa STK push prompts.",
      },
      { property: "og:title", content: "Sign in — JevishPay" },
      {
        property: "og:description",
        content: "Access your JevishPay dashboard, API keys and M-Pesa transactions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const registerFn = useServerFn(registerMerchant);
  const signInFn = useServerFn(signInUserFn);
  const getUserFn = useServerFn(getCurrentUserFn);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getUserFn().then((user) => {
      if (user) navigate({ to: "/dashboard" });
    });
  }, [getUserFn, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await registerFn({
          data: { email, password, businessName },
        });
        if (res.token) {
          localStorage.setItem("jevishpay_token", res.token);
        }
        toast.success("Account created successfully. Welcome!");
        navigate({ to: "/dashboard" });
      } else {
        const res = await signInFn({ data: { email, password } });
        if (res.token) {
          localStorage.setItem("jevishpay_token", res.token);
        }
        navigate({ to: "/dashboard" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to JevishPay
        </Link>
        <div className="mt-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Access your API keys and transactions."
              : "Start sending M-Pesa prompts in minutes."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="business">Business name</Label>
                <Input
                  id="business"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Ltd"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.co.ke"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <button
            className="mt-6 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
