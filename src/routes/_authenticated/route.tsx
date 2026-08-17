import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Waves } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { getAdminStatus } from "@/lib/admin.functions";
import { getCurrentUserFn } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/keys", label: "API keys" },
  { to: "/settings", label: "Settings" },
] as const;

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [ready, setReady] = useState(false);
  const fetchStatus = useServerFn(getAdminStatus);
  const getUserFn = useServerFn(getCurrentUserFn);

  const adminStatus = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => fetchStatus(),
    enabled: ready,
  });

  useEffect(() => {
    getUserFn()
      .then((user) => {
        if (!user) {
          navigate({ to: "/auth" });
        } else {
          setReady(true);
        }
      })
      .catch(() => {
        navigate({ to: "/auth" });
      });
  }, [getUserFn, navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2.5 font-semibold text-foreground">
            <Waves className="size-5 text-primary" />
            JevishPay
          </Link>
          <nav className="flex items-center gap-1">
            {[
              ...NAV,
              ...(adminStatus.data?.isAdmin ? [{ to: "/admin", label: "Admin" } as const] : []),
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  pathname === item.to
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              localStorage.removeItem("jevishpay_token");
              navigate({ to: "/auth" });
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Outlet />
      </main>
    </div>
  );
}
