import {
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  RotateCw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useSubscriptionService } from "@/hooks/useSubscriptionService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SubscriptionStatusWidget() {
  const { subscription: sub, isLoading, refetch, isRefetching } = useSubscriptionService();

  const handleRefresh = async () => {
    await refetch();
    toast.success("Subscription status re-verified");
  };

  if (isLoading) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-2xl border border-border bg-card p-6">
        <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const status = sub?.status ?? "inactive";
  const isActive = status === "active" || status === "trialing";
  const isSuspended = status === "suspended";

  const expiresSoon = (() => {
    if (!isActive || !sub?.current_period_end) return false;
    const endDate = new Date(sub.current_period_end);
    const msDiff = endDate.getTime() - Date.now();
    const daysLeft = msDiff / (1000 * 60 * 60 * 24);
    return daysLeft <= 3 && daysLeft > 0;
  })();

  return (
    <div className="space-y-4">
      {expiresSoon && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Subscription Expiring Soon</p>
            <p className="text-xs opacity-80">
              Your API access will expire in less than 3 days. Renew now to avoid interruption.
            </p>
          </div>
          <Link to="/settings">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
            >
              Renew
            </Button>
          </Link>
        </div>
      )}

      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Subscription Status
            </h2>
            <div className="flex items-center gap-2">
              {isActive ? (
                <span className="flex items-center gap-1.5 text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" /> Active Access
                </span>
              ) : isSuspended ? (
                <span className="flex items-center gap-1.5 text-lg font-semibold text-destructive">
                  <AlertTriangle className="size-5" /> Suspended
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-lg font-semibold text-muted-foreground">
                  <Clock className="size-5" /> Inactive
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleRefresh}
              disabled={isRefetching}
            >
              <RotateCw className={isRefetching ? "animate-spin size-3.5" : "size-3.5"} />
              Refresh
            </Button>
            <Link
              to="/settings"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <Button variant="ghost" size="icon" className="size-8">
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background shadow-sm border border-border/50">
            <CalendarClock className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Access Expires On</p>
            <p className="text-sm font-semibold text-foreground">
              {isActive ? formatDate(sub?.current_period_end ?? null) : "No active subscription"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
