import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { checkTransactionStatus, listTransactions, sendStkPush } from "@/lib/payments.functions";
import { SubscriptionStatusWidget } from "@/components/billing/SubscriptionStatusWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RotateCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — JevishPay M-Pesa payments" },
      {
        name: "description",
        content: "Send M-Pesa STK push prompts and track every payment attempt in real time.",
      },
      { property: "og:title", content: "JevishPay dashboard" },
      {
        property: "og:description",
        content: "Send STK pushes and monitor M-Pesa transactions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const STATUS_TONE: Record<string, string> = {
  success: "bg-primary/10 text-primary",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-destructive/10 text-destructive",
};

function Dashboard() {
  const queryClient = useQueryClient();
  const fetchTransactions = useServerFn(listTransactions);
  const push = useServerFn(sendStkPush);
  const checkStatusFn = useServerFn(checkTransactionStatus);

  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const transactions = useQuery({
    queryKey: ["transactions"],
    queryFn: () => fetchTransactions(),
    refetchInterval: 5000,
  });

  async function onSyncStatus(txId: string) {
    setCheckingId(txId);
    try {
      const res = await checkStatusFn({ data: { id: txId } });
      toast.info(`Status updated: ${res.status}${res.result_desc ? ` (${res.result_desc})` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not query status");
    } finally {
      setCheckingId(null);
    }
  }

  const mutation = useMutation({
    mutationFn: (input: {
      phone: string;
      amount: number;
      accountReference?: string;
      description?: string;
    }) => push({ data: input }),
    onSuccess: (result) => {
      toast.success(result.message ?? "STK push sent");
      setPhone("");
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "STK push failed"),
  });

  return (
    <div className="space-y-8">
      <SubscriptionStatusWidget />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold text-foreground">Send a payment prompt</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The customer gets an M-Pesa PIN prompt on their phone.
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate({
                phone,
                amount: Number(amount),
                ...(reference ? { accountReference: reference } : {}),
                ...(description ? { description } : {}),
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712 345 678"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (KES)</Label>
              <Input
                id="amount"
                type="number"
                min={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Account reference</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="INV-1042"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Order payment"
              />
            </div>
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Sending…" : "Send STK push"}
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recent transactions</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="relative flex size-2 text-emerald-500">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span>Auto-refreshing</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={async () => {
                await queryClient.invalidateQueries({ queryKey: ["transactions"] });
                toast.success("Transactions refreshed");
              }}
              disabled={transactions.isRefetching}
            >
              <RotateCw className={`size-3.5 ${transactions.isRefetching ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Phone</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Reference</th>
                  <th className="py-2">Receipt</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(transactions.data ?? []).map((tx) => (
                  <tr key={tx.id} className="border-t border-border">
                    <td className="py-2.5 text-foreground">{tx.phone}</td>
                    <td className="py-2.5 text-foreground">
                      KES {Number(tx.amount).toLocaleString()}
                    </td>
                    <td className="py-2.5 text-muted-foreground">{tx.account_reference ?? "—"}</td>
                    <td className="py-2.5 text-muted-foreground">{tx.mpesa_receipt ?? "—"}</td>
                    <td className="py-2.5">
                      <Badge
                        variant="secondary"
                        className={STATUS_TONE[tx.status] ?? "bg-muted text-muted-foreground"}
                      >
                        {tx.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      {tx.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={checkingId === tx.id}
                          onClick={() => onSyncStatus(tx.id)}
                        >
                          <RotateCw
                            className={`mr-1 size-3 ${checkingId === tx.id ? "animate-spin" : ""}`}
                          />
                          Sync status
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.data?.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No transactions yet. Send your first STK push.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
