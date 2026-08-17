import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileText,
  History,
  RotateCw,
  Search,
  ShieldAlert,
  Smartphone,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { listSubscriptionPayments, getMySubscription } from "@/lib/subscription.functions";
import { listTransactions } from "@/lib/payments.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface HistoryItem {
  id: string;
  source: "subscription" | "transaction";
  type: string;
  phone: string;
  amount: number;
  status: string;
  mpesaReceipt: string | null;
  reference: string | null;
  description: string | null;
  resultDesc: string | null;
  createdAt: string;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatRelative(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const diffSeconds = Math.round((Date.now() - d.getTime()) / 1000);
    if (diffSeconds < 60) return "Just now";
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  } catch {
    return "";
  }
}

export function AccountHistoryList() {
  const queryClient = useQueryClient();
  const fetchSubHistory = useServerFn(listSubscriptionPayments);
  const fetchTxHistory = useServerFn(listTransactions);
  const fetchCurrentSub = useServerFn(getMySubscription);

  const [activeFilter, setActiveFilter] = useState<"all" | "subscription" | "transactions">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const subQuery = useQuery({
    queryKey: ["subscription-payments-history"],
    queryFn: () => fetchSubHistory(),
    refetchInterval: autoRefreshEnabled ? 30000 : false,
  });

  const txQuery = useQuery({
    queryKey: ["merchant-transactions-history"],
    queryFn: () => fetchTxHistory(),
    refetchInterval: autoRefreshEnabled ? 30000 : false,
  });

  const currentSubQuery = useQuery({
    queryKey: ["current-subscription-status"],
    queryFn: () => fetchCurrentSub(),
    refetchInterval: autoRefreshEnabled ? 30000 : false,
  });

  const isLoading = subQuery.isLoading || txQuery.isLoading;
  const isRefetching = subQuery.isRefetching || txQuery.isRefetching;

  // Update last refreshed timestamp whenever queries complete fetching
  useEffect(() => {
    if (subQuery.dataUpdatedAt || txQuery.dataUpdatedAt) {
      setLastRefreshedAt(
        new Date(Math.max(subQuery.dataUpdatedAt || 0, txQuery.dataUpdatedAt || 0, Date.now())),
      );
    }
  }, [subQuery.dataUpdatedAt, txQuery.dataUpdatedAt]);

  const handleRefresh = async () => {
    await Promise.all([
      subQuery.refetch(),
      txQuery.refetch(),
      currentSubQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["subscription"] }),
    ]);
    setLastRefreshedAt(new Date());
    toast.success("Transaction history & status refreshed");
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  // Combine and normalize all logs into a unified timeline
  const combinedHistory = useMemo<HistoryItem[]>(() => {
    const items: HistoryItem[] = [];

    // Subscription payments
    if (subQuery.data) {
      for (const p of subQuery.data) {
        items.push({
          id: `sub-${p.id}`,
          source: "subscription",
          type: "Subscription Payment",
          phone: p.phone,
          amount: Number(p.amount || 0),
          status: p.status,
          mpesaReceipt: p.mpesa_receipt,
          reference: p.checkout_request_id ? `Checkout: ${p.checkout_request_id.slice(-8)}` : null,
          description: "1-Month SaaS Unlimited API Access",
          resultDesc: p.result_desc,
          createdAt: p.created_at,
        });
      }
    }

    // Merchant transactions
    if (txQuery.data) {
      for (const t of txQuery.data) {
        items.push({
          id: `tx-${t.id}`,
          source: "transaction",
          type: "Merchant Customer STK",
          phone: t.phone,
          amount: Number(t.amount || 0),
          status: t.status,
          mpesaReceipt: t.mpesa_receipt,
          reference: t.account_reference || "M-Pesa Express",
          description: t.description || null,
          resultDesc: t.result_desc,
          createdAt: t.created_at,
        });
      }
    }

    // Sort descending by created_at
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [subQuery.data, txQuery.data]);

  // Filtered by tab and search term
  const filteredHistory = useMemo(() => {
    return combinedHistory.filter((item) => {
      if (activeFilter === "subscription" && item.source !== "subscription") return false;
      if (activeFilter === "transactions" && item.source !== "transaction") return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase().trim();
      return (
        item.phone.toLowerCase().includes(term) ||
        (item.mpesaReceipt && item.mpesaReceipt.toLowerCase().includes(term)) ||
        (item.reference && item.reference.toLowerCase().includes(term)) ||
        (item.description && item.description.toLowerCase().includes(term)) ||
        (item.resultDesc && item.resultDesc.toLowerCase().includes(term))
      );
    });
  }, [combinedHistory, activeFilter, searchTerm]);

  const currentSub = currentSubQuery.data;

  return (
    <section id="account-history-section" className="space-y-6">
      {/* Current Subscription Status Timeline Summary Banner */}
      {currentSub && (
        <div
          id="subscription-status-summary-card"
          className="rounded-2xl border border-border bg-card p-5 shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Zap className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Active Plan Status
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <h2 className="text-base font-semibold text-foreground">Standard Monthly Plan</h2>
                  <Badge
                    variant={
                      currentSub.status === "active"
                        ? "default"
                        : currentSub.status === "suspended"
                          ? "destructive"
                          : "outline"
                    }
                    className="capitalize text-xs"
                  >
                    {currentSub.status}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Period Validity</span>
                <span className="font-medium text-foreground">
                  {currentSub.current_period_start
                    ? `${formatDate(currentSub.current_period_start)} — ${formatDate(currentSub.current_period_end)}`
                    : "No active billing cycle"}
                </span>
              </div>
              {currentSub.last_mpesa_receipt && (
                <div>
                  <span className="text-xs text-muted-foreground block">Latest Receipt</span>
                  <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                    <span>{currentSub.last_mpesa_receipt}</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(currentSub.last_mpesa_receipt!, "Receipt Code")
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                      title="Copy receipt code"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Ledger Card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="size-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                Transaction & Billing History
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only ledger of your subscription payments, renewals, and merchant STK
              transactions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
              <span
                className={`relative flex size-2 ${
                  autoRefreshEnabled ? "text-emerald-500" : "text-muted-foreground"
                }`}
              >
                {autoRefreshEnabled && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    autoRefreshEnabled ? "bg-emerald-500" : "bg-muted-foreground"
                  }`}
                />
              </span>
              <span className="font-medium">
                {autoRefreshEnabled ? "Auto-refresh: 30s" : "Auto-refresh: Paused"}
              </span>
              <span className="text-border">|</span>
              <span className="text-[11px] opacity-80">
                {lastRefreshedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>

            <Button
              id="refresh-history-btn"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefetching}
              className="gap-2 h-8 text-xs"
            >
              <RotateCw className={isRefetching ? "size-3.5 animate-spin" : "size-3.5"} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/50">
            <button
              id="filter-all-btn"
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeFilter === "all"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Activity ({combinedHistory.length})
            </button>
            <button
              id="filter-subs-btn"
              type="button"
              onClick={() => setActiveFilter("subscription")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeFilter === "subscription"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Subscriptions ({combinedHistory.filter((i) => i.source === "subscription").length})
            </button>
            <button
              id="filter-txs-btn"
              type="button"
              onClick={() => setActiveFilter("transactions")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeFilter === "transactions"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Merchant Payments ({combinedHistory.filter((i) => i.source === "transaction").length})
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="search-history-input"
              type="text"
              placeholder="Filter by phone, receipt, or ref..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
        </div>

        {/* Ledger List */}
        <div className="mt-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm">Loading transaction ledger...</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <FileText className="size-6" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">No records found</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                {searchTerm
                  ? "No transactions matched your search filter. Try clearing your query."
                  : "You have not made any subscription payments or customer transactions yet."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-xl border border-border/80 overflow-hidden bg-background">
              {filteredHistory.map((item) => {
                const isSuccess = item.status === "success" || item.status === "active";
                const isPending = item.status === "pending";
                const isCancelled = item.status === "cancelled";
                const isFailed = item.status === "failed";

                return (
                  <div
                    key={item.id}
                    id={`history-row-${item.id}`}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                  >
                    {/* Left details */}
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                          item.source === "subscription"
                            ? "bg-primary/10 text-primary"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {item.source === "subscription" ? (
                          <CreditCard className="size-5" />
                        ) : (
                          <Smartphone className="size-5" />
                        )}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{item.type}</span>
                          <Badge
                            variant={
                              isSuccess
                                ? "default"
                                : isFailed
                                  ? "destructive"
                                  : isPending
                                    ? "secondary"
                                    : "outline"
                            }
                            className={`text-[10px] px-2 py-0.5 capitalize ${
                              isSuccess
                                ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/20 border-emerald-500/20"
                                : isPending
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                  : isCancelled
                                    ? "bg-muted text-muted-foreground border-border"
                                    : ""
                            }`}
                          >
                            {isSuccess && <CheckCircle2 className="mr-1 size-3" />}
                            {isPending && <Clock className="mr-1 size-3 animate-pulse" />}
                            {isFailed && <ShieldAlert className="mr-1 size-3" />}
                            {isCancelled && <XCircle className="mr-1 size-3" />}
                            {item.status}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono text-foreground/80">{item.phone}</span>
                          {item.reference && (
                            <>
                              <span>•</span>
                              <span>{item.reference}</span>
                            </>
                          )}
                          {item.mpesaReceipt && (
                            <>
                              <span>•</span>
                              <div className="flex items-center gap-1 font-mono font-medium text-foreground">
                                <span>{item.mpesaReceipt}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyToClipboard(item.mpesaReceipt!, "Receipt code")
                                  }
                                  className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                                  title="Copy receipt"
                                >
                                  <Copy className="size-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        {item.resultDesc && !isSuccess && (
                          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium line-clamp-1">
                            {item.resultDesc}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right amount and time */}
                    <div className="flex items-center justify-between sm:flex-col sm:items-end gap-1 shrink-0 pl-13 sm:pl-0">
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        KES {item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="size-3" />
                        <span>{formatDate(item.createdAt)}</span>
                        <span className="text-[11px] opacity-75">
                          ({formatRelative(item.createdAt)})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
