import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/keys")({
  head: () => ({
    meta: [
      { title: "API keys — JevishPay" },
      {
        name: "description",
        content:
          "Create and revoke JevishPay API keys used to trigger M-Pesa STK pushes from your own backend.",
      },
      { property: "og:title", content: "API keys — JevishPay" },
      {
        property: "og:description",
        content: "Manage the keys that authorise M-Pesa STK push requests.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KeysPage,
});

function KeysPage() {
  const queryClient = useQueryClient();
  const fetchKeys = useServerFn(listApiKeys);
  const create = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);

  const [name, setName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => fetchKeys() });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { name: name || "Default key" } }),
    onSuccess: (result) => {
      setFreshKey(result.key);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create key"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("Key revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  return (
    <div className="max-w-3xl space-y-8">
      <section className="rounded-2xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold text-foreground">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use a key to call the STK push endpoint from your own server.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="keyname">Key name</Label>
            <Input
              id="keyname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production server"
            />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            Create key
          </Button>
        </div>

        {freshKey && (
          <div className="mt-5 rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm font-medium text-foreground">
              Copy this key now — it won't be shown again.
            </p>
            <code className="mt-2 block break-all rounded bg-background p-3 text-sm">
              {freshKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                navigator.clipboard.writeText(freshKey);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
          </div>
        )}

        <ul className="mt-6 divide-y divide-border">
          {(keys.data ?? []).map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  {key.key_prefix}••••• ·{" "}
                  {key.revoked_at
                    ? "revoked"
                    : `created ${new Date(key.created_at).toLocaleDateString()}`}
                </p>
              </div>
              {!key.revoked_at && (
                <Button variant="outline" size="sm" onClick={() => revokeMutation.mutate(key.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-6 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            API Documentation &amp; Integration Guide
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your API key to send M-Pesa STK push requests directly from your backend or
            application.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Endpoint URL
          </Label>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 p-3">
            <Badge
              variant="secondary"
              className="bg-primary/10 font-mono text-xs font-bold uppercase text-primary"
            >
              POST
            </Badge>
            <code className="flex-1 break-all font-mono text-xs font-medium text-foreground md:text-sm">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/public/stk/push
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                const url = `${window.location.origin}/api/public/stk/push`;
                navigator.clipboard.writeText(url);
                toast.success("Endpoint URL copied");
              }}
            >
              Copy URL
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Request Headers &amp; Body Parameters
          </Label>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Parameter</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Required</th>
                  <th className="px-3 py-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground">
                <tr>
                  <td className="px-3 py-2 font-mono font-semibold text-primary">phone</td>
                  <td className="px-3 py-2">String</td>
                  <td className="px-3 py-2 font-medium text-amber-600 dark:text-amber-400">Yes</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    Customer phone number (e.g. <code>254712345678</code> or <code>0712345678</code>
                    )
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono font-semibold text-primary">amount</td>
                  <td className="px-3 py-2">Number</td>
                  <td className="px-3 py-2 font-medium text-amber-600 dark:text-amber-400">Yes</td>
                  <td className="px-3 py-2 text-muted-foreground">Amount in KES (Minimum: 1)</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono font-semibold text-primary">
                    accountReference
                  </td>
                  <td className="px-3 py-2">String</td>
                  <td className="px-3 py-2 text-muted-foreground">Optional</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    Reference account or order ID (e.g. <code>INV-102</code>)
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-mono font-semibold text-primary">description</td>
                  <td className="px-3 py-2">String</td>
                  <td className="px-3 py-2 text-muted-foreground">Optional</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    Short payment note shown on phone prompt
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            cURL Example
          </Label>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
            {`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "https://your-domain.com"}/api/public/stk/push \\
  -H "Authorization: Bearer ${freshKey || "jp_live_your_api_key"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "254712345678",
    "amount": 100,
    "accountReference": "INV-102",
    "description": "Order Payment"
  }'`}
          </pre>
        </div>

        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            JavaScript / Node.js Example
          </Label>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
            {`const response = await fetch("${typeof window !== "undefined" ? window.location.origin : "https://your-domain.com"}/api/public/stk/push", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${freshKey || "jp_live_your_api_key"}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    phone: "254712345678",
    amount: 100,
    accountReference: "INV-102",
    description: "Order Payment"
  })
});

const result = await response.json();
console.log(result);`}
          </pre>
        </div>
      </section>
    </div>
  );
}
