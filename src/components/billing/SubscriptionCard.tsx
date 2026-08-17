import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Smartphone, AlertTriangle, Key } from "lucide-react";

import { useSubscriptionService } from "@/hooks/useSubscriptionService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function SubscriptionCard() {
  const queryClient = useQueryClient();
  const {
    subscription: sub,
    payStk,
    isPaying,
    confirmManualCode,
    isConfirming,
    checkStatus,
  } = useSubscriptionService();

  const [phone, setPhone] = useState("");
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  // Polling loop when STK push is triggered
  useEffect(() => {
    if (!activePaymentId) return;

    let attempts = 0;
    const maxAttempts = 20; // 60 seconds

    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await checkStatus(activePaymentId);
        if (res.status === "success") {
          clearInterval(interval);
          setActivePaymentId(null);
          toast.success("M-Pesa payment confirmed! Your 1-month subscription is now active.");
          queryClient.invalidateQueries({ queryKey: ["subscription"] });
        } else if (res.status === "failed" || res.status === "cancelled") {
          clearInterval(interval);
          setActivePaymentId(null);
          const desc = res.result_desc || "";
          if (desc.toLowerCase().includes("bad debt contract") || desc.includes("E3008")) {
            toast.error(
              "Safaricom restriction: This M-Pesa line has a bad debt/Fuliza restriction. Please try another phone number or enter your M-Pesa receipt code below.",
            );
            setShowManualInput(true);
          } else if (res.status === "cancelled" || desc.includes("1032")) {
            toast.info("M-Pesa STK push prompt was cancelled.");
          } else {
            toast.error(desc || "M-Pesa payment was not completed.");
            setShowManualInput(true);
          }
        }
      } catch (e) {
        console.warn("Polling error (transient)", e);
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setActivePaymentId(null);
        toast.info(
          "STK response timed out. Enter your M-Pesa receipt code if payment went through.",
        );
        setShowManualInput(true);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activePaymentId, checkStatus, queryClient]);

  const status = sub?.status ?? "inactive";
  const isActive = status === "active" || status === "trialing";
  const isSuspended = status === "suspended";
  const fee = sub?.fee && sub.fee > 0 ? sub.fee : 100;

  return (
    <section id="billing" className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">API Subscription</h2>
            <Badge variant="outline" className="border-primary/20 text-primary">
              M-Pesa
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Standard Plan — KES {fee} / month. Gives 1 full month unlimited API access.
          </p>
        </div>

        <Badge
          variant="secondary"
          className={
            isActive
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              : isSuspended
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-muted text-muted-foreground"
          }
        >
          {isActive ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5" /> Active (1 Month Access)
            </span>
          ) : isSuspended ? (
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" /> API Access Suspended
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" /> Inactive
            </span>
          )}
        </Badge>
      </div>

      {isActive ? (
        <div className="mt-5 rounded-xl border border-border/60 bg-muted/40 p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Period Started
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatDate(sub?.current_period_start ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Due Date / Renews On
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatDate(sub?.current_period_end ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Last Receipt
              </dt>
              <dd className="mt-1 font-mono text-xs font-semibold text-foreground">
                {sub?.last_mpesa_receipt ?? "STK PUSH CONFIRMED"}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-foreground">
            {isSuspended
              ? "Your API access has been suspended because 1 month has passed since your last payment."
              : "Subscribe to unlock your API key and start accepting M-Pesa payments."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pay KES {fee} via M-Pesa to immediately activate 1 month of API access.
          </p>
        </div>
      )}

      {/* Payment Action Box */}
      <div className="mt-6 space-y-4">
        {activePaymentId ? (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <div>
              <p className="font-medium">M-Pesa STK Push Sent!</p>
              <p className="text-xs text-muted-foreground">
                Please check your phone and enter your M-Pesa PIN to complete payment of KES {fee}.
              </p>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = phone.trim();
              if (!trimmed) {
                toast.error("Please enter your M-Pesa phone number");
                return;
              }
              try {
                const data = await payStk(trimmed);
                if (data?.paymentId) {
                  setActivePaymentId(data.paymentId);
                }
              } catch {
                // error is already toasted by the mutation
              }
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="sub-phone" className="text-xs text-muted-foreground">
                M-Pesa Phone Number
              </Label>
              <div className="relative">
                <Smartphone className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="sub-phone"
                  placeholder="0712345678 or 254712345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Button type="submit" disabled={isPaying} className="whitespace-nowrap">
              {isPaying
                ? "Sending STK Push…"
                : isActive
                  ? `Renew Access — KES ${fee}`
                  : `Pay KES ${fee} via M-Pesa`}
            </Button>
          </form>
        )}

        {/* Manual Code Input Option */}
        <div className="pt-2">
          {!showManualInput ? (
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Have an M-Pesa receipt code? Verify manually
            </button>
          ) : (
            <form
              className="flex items-end gap-3 rounded-xl border border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!manualCode.trim()) return;
                confirmManualCode(manualCode)
                  .then(() => {
                    setManualCode("");
                    setShowManualInput(false);
                  })
                  .catch(() => {});
              }}
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="manual-code" className="text-xs text-muted-foreground">
                  M-Pesa Transaction Code (e.g. QGE123456)
                </Label>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="manual-code"
                    placeholder="QGE..."
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    className="pl-9 uppercase"
                  />
                </div>
              </div>
              <Button type="submit" variant="secondary" size="sm" disabled={isConfirming}>
                {isConfirming ? "Verifying…" : "Confirm Code"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
