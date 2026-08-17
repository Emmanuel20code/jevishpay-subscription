import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { query, queryOne } from "./db";

export const getMerchantSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = await queryOne(
      `SELECT user_id, shortcode, account_type FROM public.merchant_settings WHERE user_id = $1`,
      [context.userId],
    );
    return settings;
  });

export const saveMerchantSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        shortcode: z.string().trim().max(12).optional(),
        account_type: z.enum(["paybill", "till"]),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await query(
      `INSERT INTO public.merchant_settings (user_id, shortcode, account_type, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE 
       SET shortcode = EXCLUDED.shortcode, account_type = EXCLUDED.account_type, updated_at = now()`,
      [context.userId, data.shortcode || null, data.account_type],
    );
    return { ok: true };
  });

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const keys = await query(
      `SELECT id, name, key_prefix, last_used_at, revoked_at, created_at 
       FROM public.api_keys 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [context.userId],
    );
    return keys;
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60) }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { generateApiKey, hashApiKey } = await import("./payments.server");
    const { raw, prefix } = generateApiKey();
    const keyHash = await hashApiKey(raw);

    await query(
      `INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4)`,
      [context.userId, data.name, keyHash, prefix],
    );

    return { key: raw };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await query(`UPDATE public.api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2`, [
      data.id,
      context.userId,
    ]);
    return { ok: true };
  });

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const txs = await query(
      `SELECT id, phone, amount, status, account_reference, description, mpesa_receipt, result_desc, created_at 
       FROM public.transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [context.userId],
    );
    return txs;
  });

export const sendStkPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        phone: z.string().trim().min(9).max(15),
        amount: z.number().min(1).max(300000),
        accountReference: z.string().trim().max(64).optional(),
        description: z.string().trim().max(60).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { runStkPush } = await import("./payments.server");
    const origin = new URL(getRequest().url).origin;
    return runStkPush(context.userId, data, null, origin);
  });

export const checkTransactionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { checkAndSyncTransactionStatus } = await import("./payments.server");
    return checkAndSyncTransactionStatus(data.id, context.userId);
  });
