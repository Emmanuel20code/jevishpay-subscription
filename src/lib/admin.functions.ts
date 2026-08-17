import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { query, queryOne } from "./db";
import { activateSubscriptionForUser } from "./payments.server";
import { ensureSaasSchema } from "./saas-schema";

const credentialsSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
  consumer_key: z.string().trim().max(200).optional(),
  consumer_secret: z.string().trim().max(200).optional(),
  default_shortcode: z.string().trim().max(12).optional(),
  default_passkey: z.string().trim().max(200).optional(),
  default_callback_url: z.string().trim().max(300).optional(),
  saas_till_number: z.string().trim().min(1, "Till Number is mandatory").max(20),
  saas_shortcode_type: z.enum(["till", "paybill"]).optional(),
  saas_paybill_account: z.string().trim().max(50).optional(),
  saas_subscription_fee: z
    .number()
    .int("Payment amount must be an integer")
    .positive("Payment amount must be a positive integer"),
});

async function assertAdmin(userId: string) {
  const adminRole = await queryOne<{ id: string }>(
    `SELECT id FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
    [userId],
  );
  if (!adminRole) throw new Error("Forbidden: super admin only");
}

export const getAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureSaasSchema();
    const adminCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM public.user_roles WHERE role = 'admin'`,
    );
    const count = parseInt(adminCount?.count || "0", 10);
    return { isAdmin: context.isAdmin, adminExists: count > 0 };
  });

export const claimSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureSaasSchema();
    const adminCount = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM public.user_roles WHERE role = 'admin'`,
    );
    const count = parseInt(adminCount?.count || "0", 10);
    if (count > 0) {
      throw new Error("A super admin already exists");
    }

    await query(
      `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
      [context.userId],
    );
    return { ok: true };
  });

export const getPlatformCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    await ensureSaasSchema();

    const data = await queryOne<{
      environment: string;
      consumer_key: string | null;
      consumer_secret: string | null;
      default_shortcode: string | null;
      default_passkey: string | null;
      default_callback_url: string | null;
      saas_till_number: string | null;
      saas_shortcode_type: string | null;
      saas_paybill_account: string | null;
      saas_subscription_fee: number | string | null;
      updated_at: string | null;
    }>(`SELECT * FROM public.platform_credentials WHERE id = true`);

    const mask = (v: string | null | undefined) =>
      v ? `${v.slice(0, 4)}••••${v.slice(-2)}` : null;

    return {
      environment: (data?.environment ?? "sandbox") as "sandbox" | "production",
      consumer_key: data?.consumer_key ?? "",
      default_shortcode: data?.default_shortcode ?? "",
      default_callback_url: data?.default_callback_url ?? "",
      consumer_secret_masked: mask(data?.consumer_secret),
      default_passkey_masked: mask(data?.default_passkey),
      saas_till_number: data?.saas_till_number ?? "",
      saas_shortcode_type: (data?.saas_shortcode_type ?? "till") as "till" | "paybill",
      saas_paybill_account: data?.saas_paybill_account ?? "SUBSCRIPTION",
      saas_subscription_fee: (() => {
        const raw = Number(data?.saas_subscription_fee);
        return !isNaN(raw) && raw > 0 ? raw : 100;
      })(),
      updated_at: data?.updated_at ?? null,
    };
  });

export const savePlatformCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => credentialsSchema.parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    await ensureSaasSchema();

    const existing = await queryOne<{ consumer_secret: string; default_passkey: string }>(
      `SELECT consumer_secret, default_passkey FROM public.platform_credentials WHERE id = true`,
    );

    const secret = data.consumer_secret || existing?.consumer_secret || null;
    const passkey = data.default_passkey || existing?.default_passkey || null;

    await query(
      `INSERT INTO public.platform_credentials (
         id, environment, consumer_key, default_shortcode, default_callback_url,
         consumer_secret, default_passkey, saas_till_number, saas_shortcode_type,
         saas_paybill_account, saas_subscription_fee, updated_by, updated_at
       ) VALUES (
         true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
       ) ON CONFLICT (id) DO UPDATE SET
           environment = EXCLUDED.environment,
           consumer_key = EXCLUDED.consumer_key,
           default_shortcode = EXCLUDED.default_shortcode,
           default_callback_url = EXCLUDED.default_callback_url,
           consumer_secret = EXCLUDED.consumer_secret,
           default_passkey = EXCLUDED.default_passkey,
           saas_till_number = EXCLUDED.saas_till_number,
           saas_shortcode_type = EXCLUDED.saas_shortcode_type,
           saas_paybill_account = EXCLUDED.saas_paybill_account,
           saas_subscription_fee = EXCLUDED.saas_subscription_fee,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
      [
        data.environment,
        data.consumer_key || null,
        data.default_shortcode || null,
        data.default_callback_url || null,
        secret,
        passkey,
        data.saas_till_number || null,
        data.saas_shortcode_type || "till",
        data.saas_paybill_account || "SUBSCRIPTION",
        data.saas_subscription_fee,
        context.userId,
      ],
    );

    return { ok: true };
  });

interface MerchantProfile {
  id: string;
  email: string;
  business_name: string | null;
  created_at: string;
}

interface TransactionRecord {
  id: string;
  user_id: string;
  phone: string;
  amount: number | string;
  status: string;
  shortcode: string;
  created_at: string;
}

interface SubscriptionRecord {
  user_id: string;
  email: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  last_mpesa_receipt: string | null;
  last_amount_paid: number | string | null;
}

export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    await ensureSaasSchema();

    const [merchants, txs, admins, adminUsers, subs] = await Promise.all([
      query<MerchantProfile>(
        `SELECT id, email, business_name, created_at FROM public.profiles ORDER BY created_at DESC LIMIT 50`,
      ),
      query<TransactionRecord>(
        `SELECT id, user_id, phone, amount, status, shortcode, created_at FROM public.transactions ORDER BY created_at DESC LIMIT 50`,
      ),
      query<{ user_id: string }>(`SELECT user_id FROM public.user_roles WHERE role = 'admin'`),
      query<MerchantProfile>(
        `SELECT ur.user_id as id, coalesce(p.email, u.email) as email, p.business_name, coalesce(p.created_at, u.created_at) as created_at
         FROM public.user_roles ur
         LEFT JOIN public.profiles p ON ur.user_id = p.id
         LEFT JOIN auth.users u ON ur.user_id = u.id
         WHERE ur.role = 'admin'`,
      ),
      query<SubscriptionRecord>(
        `SELECT user_id, email, status, current_period_start, current_period_end, last_mpesa_receipt, last_amount_paid FROM public.subscriptions ORDER BY current_period_end DESC NULLS LAST`,
      ),
    ]);

    const settled = txs.filter((t) => t.status === "success");
    return {
      merchants,
      transactions: txs,
      subscriptions: subs,
      adminUserIds: admins.map((a) => a.user_id),
      adminUsers,
      stats: {
        merchantCount: merchants.length,
        transactionCount: txs.length,
        volume: settled.reduce((sum: number, t) => sum + Number(t.amount), 0),
        activeSubscribers: subs.filter((s) => s.status === "active").length,
      },
    };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ userId: z.string().uuid(), makeAdmin: z.boolean() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    if (data.userId === context.userId && !data.makeAdmin) {
      throw new Error("You cannot remove your own super admin access");
    }

    if (data.makeAdmin) {
      const adminCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM public.user_roles WHERE role = 'admin'`,
      );
      const count = parseInt(adminCount?.count || "0", 10);

      if (count > 0) {
        throw new Error(
          "Only one super admin account is allowed. Cannot grant admin role to another user.",
        );
      }

      await query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
        [data.userId],
      );
    } else {
      await query(`DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`, [
        data.userId,
      ]);
    }

    return { ok: true };
  });

export const adminActivateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const master = await queryOne<{ saas_subscription_fee: string | number }>(
      `SELECT saas_subscription_fee FROM public.platform_credentials WHERE id = true`,
    );
    const rawFee = Number(master?.saas_subscription_fee);
    const fee = !isNaN(rawFee) && rawFee > 0 ? rawFee : 100;
    await activateSubscriptionForUser(data.userId, fee, "ADMIN_MANUAL");
    return { ok: true };
  });

/** Retrieves GitHub sync configuration and repository status for Super Admins. */
export const getGitHubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { getGitStatusAndConfig } = await import("./github-sync.server");
    return getGitStatusAndConfig();
  });

/** Saves GitHub sync settings (Repository URL, Target Branch, Personal Access Token). */
export const saveGitHubSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        repoUrl: z.string().trim().min(3, "Repository URL is required"),
        branch: z.string().trim().min(1, "Branch name is required"),
        token: z.string().trim().optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { saveGitConfig } = await import("./github-sync.server");
    return saveGitConfig(data);
  });

/** Pushes the application codebase to the configured GitHub repository. */
export const pushToGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        commitMessage: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { pushApplicationToGitHub } = await import("./github-sync.server");
    return pushApplicationToGitHub(data.commitMessage);
  });
