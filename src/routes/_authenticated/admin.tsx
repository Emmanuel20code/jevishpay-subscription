import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, CreditCard, Users, RefreshCw } from "lucide-react";

import {
  adminActivateSubscription,
  claimSuperAdmin,
  getAdminStatus,
  getPlatformCredentials,
  getPlatformOverview,
  savePlatformCredentials,
  setUserRole,
} from "@/lib/admin.functions";
import { GitHubSyncCard } from "@/components/admin/GitHubSyncCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Super admin console — JevishPay" },
      {
        name: "description",
        content:
          "Manage JevishPay's master Daraja API credentials, SaaS subscription settings, merchants and platform activity.",
      },
      { property: "og:title", content: "JevishPay super admin console" },
      {
        property: "og:description",
        content: "Master Daraja credentials and platform oversight for JevishPay operators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getAdminStatus);
  const claim = useServerFn(claimSuperAdmin);

  const status = useQuery({ queryKey: ["admin-status"], queryFn: () => fetchStatus() });

  const claimMutation = useMutation({
    mutationFn: () => claim(),
    onSuccess: () => {
      toast.success("You are now the JevishPay super admin");
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not claim"),
  });

  if (status.isLoading) {
    return <p className="text-sm text-muted-foreground">Checking access…</p>;
  }

  if (!status.data?.isAdmin) {
    return (
      <div className="max-w-lg rounded-2xl border border-border bg-card p-6">
        <ShieldCheck className="size-6 text-primary" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Super admin console</h1>
        {status.data?.adminExists ? (
          <p className="mt-1 text-sm text-muted-foreground">
            This area is restricted to JevishPay platform operators.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              No super admin exists yet. Claim the role to configure the master Daraja credentials
              and SaaS subscription till that powers the app.
            </p>
            <Button
              className="mt-4"
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
            >
              Claim super admin
            </Button>
          </>
        )}
      </div>
    );
  }

  return <AdminConsole />;
}

function AdminConsole() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchCreds = useServerFn(getPlatformCredentials);
  const saveCreds = useServerFn(savePlatformCredentials);
  const fetchOverview = useServerFn(getPlatformOverview);
  const updateRole = useServerFn(setUserRole);
  const activateSub = useServerFn(adminActivateSubscription);

  const creds = useQuery({ queryKey: ["platform-credentials"], queryFn: () => fetchCreds() });
  const overview = useQuery({ queryKey: ["platform-overview"], queryFn: () => fetchOverview() });

  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [shortcode, setShortcode] = useState("");
  const [passkey, setPasskey] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");

  // SaaS Subscription settings state
  const [saasTillNumber, setSaasTillNumber] = useState("");
  const [saasShortcodeType, setSaasShortcodeType] = useState<"till" | "paybill">("till");
  const [saasPaybillAccount, setSaasPaybillAccount] = useState("SUBSCRIPTION");
  const [saasSubscriptionFee, setSaasSubscriptionFee] = useState(100);

  useEffect(() => {
    const d = creds.data;
    if (!d) return;
    setEnvironment(d.environment ?? "sandbox");
    setConsumerKey(d.consumer_key ?? "");
    setShortcode(d.default_shortcode ?? "");
    setCallbackUrl(d.default_callback_url ?? "");
    setSaasTillNumber(d.saas_till_number ?? "");
    setSaasShortcodeType(d.saas_shortcode_type ?? "till");
    setSaasPaybillAccount(d.saas_paybill_account ?? "SUBSCRIPTION");
    setSaasSubscriptionFee(d.saas_subscription_fee ?? 100);
  }, [creds.data]);

  const save = useMutation({
    mutationFn: () => {
      const tillTrimmed = saasTillNumber.trim();
      if (!tillTrimmed) {
        throw new Error("Till Number is mandatory");
      }
      const feeNum = Number(saasSubscriptionFee);
      if (!Number.isInteger(feeNum) || feeNum <= 0) {
        throw new Error("Payment amount must be a strictly positive integer");
      }
      return saveCreds({
        data: {
          environment,
          consumer_key: consumerKey,
          default_shortcode: shortcode,
          default_callback_url: callbackUrl,
          saas_till_number: tillTrimmed,
          saas_shortcode_type: saasShortcodeType,
          saas_paybill_account: saasPaybillAccount,
          saas_subscription_fee: feeNum,
          ...(consumerSecret ? { consumer_secret: consumerSecret } : {}),
          ...(passkey ? { default_passkey: passkey } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Master credentials & SaaS subscription settings saved");
      setConsumerSecret("");
      setPasskey("");
      queryClient.invalidateQueries();
      router.invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const roleMutation = useMutation({
    mutationFn: (vars: { userId: string; makeAdmin: boolean }) => updateRole({ data: vars }),
    onSuccess: () => {
      toast.success("Access updated");
      queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Could not update";
      toast.error(msg);
    },
  });

  const activateMutation = useMutation({
    mutationFn: (userId: string) => activateSub({ data: { userId } }),
    onSuccess: () => {
      toast.success("Merchant subscription granted 1 month access!");
      queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not activate subscription");
    },
  });

  const stats = overview.data?.stats;
  const adminIds = overview.data?.adminUserIds ?? [];

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">Super admin console</h1>
          <p className="text-sm text-muted-foreground">
            Configure platform M-Pesa settings, master Daraja API credentials, and subscription
            collection tills.
          </p>
        </div>
      </header>

      {/* Overview Cards */}
      <section className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Merchants", value: stats?.merchantCount ?? 0 },
          { label: "Active Subscribers", value: stats?.activeSubscribers ?? 0 },
          { label: "Recent Transactions", value: stats?.transactionCount ?? 0 },
          {
            label: "Settled Volume (KES)",
            value: (stats?.volume ?? 0).toLocaleString(),
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{card.value}</p>
          </div>
        ))}
      </section>

      {/* SaaS Subscription Settings Section */}
      <section className="max-w-3xl rounded-2xl border border-primary/20 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2.5">
          <CreditCard className="size-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">
            SaaS Subscription M-Pesa Settings
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure which Till or Paybill number collects monthly subscription payments from
          merchants (e.g. KES 100/mo).
        </p>

        <form
          className="mt-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="saas-till">SaaS Collection Till / Shortcode</Label>
              <Input
                id="saas-till"
                value={saasTillNumber}
                onChange={(e) => setSaasTillNumber(e.target.value)}
                placeholder="e.g. 174379 or 123456"
              />
              <p className="text-xs text-muted-foreground">
                M-Pesa Till/Paybill number where merchant subscription fees will be deposited.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="saas-type">Shortcode Type</Label>
              <Select
                value={saasShortcodeType}
                onValueChange={(v) => setSaasShortcodeType(v as "till" | "paybill")}
              >
                <SelectTrigger id="saas-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="till">Buy Goods (Till Number)</SelectItem>
                  <SelectItem value="paybill">Paybill</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {saasShortcodeType === "paybill" && (
              <div className="space-y-2">
                <Label htmlFor="saas-acc">Paybill Account Reference</Label>
                <Input
                  id="saas-acc"
                  value={saasPaybillAccount}
                  onChange={(e) => setSaasPaybillAccount(e.target.value)}
                  placeholder="SUBSCRIPTION"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="saas-fee">Monthly Subscription Fee (KES)</Label>
              <Input
                id="saas-fee"
                type="number"
                min="1"
                value={saasSubscriptionFee}
                onChange={(e) => setSaasSubscriptionFee(Number(e.target.value))}
              />
            </div>
          </div>

          <hr className="border-border my-4" />

          <h2 className="text-base font-semibold text-foreground">
            Master Daraja Gateway API Credentials
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used to sign and send STK push requests on behalf of all merchants.
          </p>

          <div className="space-y-2">
            <Label htmlFor="env">Environment</Label>
            <Select
              value={environment}
              onValueChange={(v) => setEnvironment(v as "sandbox" | "production")}
            >
              <SelectTrigger id="env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production (live)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ck">Consumer key</Label>
            <Input id="ck" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs">Consumer secret</Label>
            <Input
              id="cs"
              type="password"
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              placeholder={creds.data?.consumer_secret_masked ?? "Not set"}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sc">Default Gateway Shortcode</Label>
              <Input
                id="sc"
                value={shortcode}
                onChange={(e) => setShortcode(e.target.value)}
                placeholder="174379"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pk">Default Gateway Passkey</Label>
              <Input
                id="pk"
                type="password"
                value={passkey}
                onChange={(e) => setPasskey(e.target.value)}
                placeholder={creds.data?.default_passkey_masked ?? "Not set"}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cb">Default Callback URL</Label>
            <Input
              id="cb"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder="https://.../api/public/stk/callback"
            />
          </div>

          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save All Admin Settings"}
          </Button>
        </form>
      </section>

      {/* GitHub Repository Sync & Push */}
      <GitHubSyncCard />

      {/* Subscriptions Overview Section */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Merchant Subscriptions</h2>
            <p className="text-xs text-muted-foreground">
              Track paid 1-month subscriptions and manually activate accounts if needed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["platform-overview"] })}
          >
            <RefreshCw className="size-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Merchant</th>
                <th className="py-2">Status</th>
                <th className="py-2">Started</th>
                <th className="py-2">Due Date / Expires</th>
                <th className="py-2">Last Receipt</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(overview.data?.merchants ?? []).map((m) => {
                const sub = (overview.data?.subscriptions ?? []).find((s) => s.user_id === m.id);
                const subStatus = sub?.status ?? "inactive";
                const isActive = subStatus === "active";
                const isSuspended = subStatus === "suspended";

                return (
                  <tr key={m.id}>
                    <td className="py-2.5">
                      <p className="font-medium text-foreground">
                        {m.business_name || m.email || m.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </td>
                    <td className="py-2.5">
                      <Badge
                        variant="secondary"
                        className={
                          isActive
                            ? "bg-emerald-500/10 text-emerald-600"
                            : isSuspended
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
                        }
                      >
                        {subStatus}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {sub?.current_period_start
                        ? new Date(sub.current_period_start).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-2.5 text-xs font-medium text-foreground">
                      {sub?.current_period_end
                        ? new Date(sub.current_period_end).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-muted-foreground">
                      {sub?.last_mpesa_receipt ?? "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activateMutation.isPending}
                        onClick={() => activateMutation.mutate(m.id)}
                      >
                        {isActive ? "Extend 1 Month" : "Activate 1 Month"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Super Admin Roles */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Current Super Admins</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Users currently holding administrative privileges on the platform.
        </p>
        <ul className="mt-4 divide-y divide-border">
          {(overview.data?.adminUsers ?? []).map((adm) => (
            <li key={adm.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {adm.business_name || adm.email || adm.id.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground">{adm.email}</p>
              </div>
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary border border-primary/20"
              >
                Super Admin
              </Badge>
            </li>
          ))}
          {(!overview.data?.adminUsers || overview.data.adminUsers.length === 0) && (
            <li className="py-3 text-sm text-muted-foreground">No admin accounts found.</li>
          )}
        </ul>

        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground">Manage User Roles</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Grant or revoke administrator access for any registered merchant.
          </p>
          <ul className="mt-4 divide-y divide-border">
            {(overview.data?.merchants ?? []).map((m) => {
              const isAdmin = adminIds.includes(m.id);
              return (
                <li key={m.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {m.business_name || m.email || m.id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isAdmin && <Badge variant="secondary">Admin</Badge>}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={roleMutation.isPending}
                      onClick={() => roleMutation.mutate({ userId: m.id, makeAdmin: !isAdmin })}
                    >
                      {isAdmin ? "Revoke admin" : "Make admin"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Platform Transactions Table */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">Platform Transactions</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">Phone</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Shortcode</th>
                <th className="py-2">Status</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(overview.data?.transactions ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="py-2">{t.phone}</td>
                  <td className="py-2">KES {Number(t.amount).toLocaleString()}</td>
                  <td className="py-2">{t.shortcode ?? "—"}</td>
                  <td className="py-2">{t.status}</td>
                  <td className="py-2 text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
