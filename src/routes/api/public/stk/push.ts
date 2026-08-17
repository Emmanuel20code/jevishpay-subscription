import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";

const bodySchema = z.object({
  phone: z.string().trim().min(9).max(15),
  amount: z.number().min(1).max(300000),
  accountReference: z.string().trim().max(64).optional(),
  description: z.string().trim().max(60).optional(),
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/stk/push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const rawKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
        if (!rawKey) return json({ error: "Missing API key" }, 401);

        const { hashApiKey, runStkPush, checkActiveSubscription } =
          await import("@/lib/payments.server");
        const keyHash = await hashApiKey(rawKey);

        const keyRow = await queryOne<{ id: string; user_id: string; revoked_at: string | null }>(
          `SELECT id, user_id, revoked_at FROM public.api_keys WHERE key_hash = $1`,
          [keyHash],
        );

        if (!keyRow || keyRow.revoked_at) return json({ error: "Invalid API key" }, 401);

        const isSubscribed = await checkActiveSubscription(keyRow.user_id);
        if (!isSubscribed) {
          return json(
            {
              error:
                "Forbidden: Active subscription required. Please activate your monthly subscription to initiate payments via API.",
            },
            403,
          );
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid request body" }, 400);

        await query(`UPDATE public.api_keys SET last_used_at = now() WHERE id = $1`, [keyRow.id]);

        try {
          const result = await runStkPush(
            keyRow.user_id,
            parsed.data,
            keyRow.id,
            new URL(request.url).origin,
          );
          return json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "STK push failed";
          console.error("STK push failed:", message);
          return json({ error: message }, 502);
        }
      },
    },
  },
});
