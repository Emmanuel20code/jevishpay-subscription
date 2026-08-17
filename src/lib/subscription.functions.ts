import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { query, queryOne } from "./db";
import {
  activateSubscriptionForUser,
  checkAndSyncSubscriptionPayment,
  checkActiveSubscription,
  loadMasterCredentials,
  paySaasSubscriptionStkPush,
} from "./payments.server";

/** The signed-in user's subscription record and SaaS pricing details. */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Run active check to auto-suspend if current_period_end has passed
    const isActive = await checkActiveSubscription(context.userId);

    const [sub, master] = await Promise.all([
      queryOne<{
        status: string;
        current_period_start: string | null;
        current_period_end: string | null;
        last_mpesa_receipt: string | null;
        last_amount_paid: number | string | null;
      }>(
        `SELECT status, current_period_start, current_period_end, last_mpesa_receipt, last_amount_paid
         FROM public.subscriptions
         WHERE user_id = $1`,
        [context.userId],
      ),
      loadMasterCredentials(),
    ]);

    const rawFee = Number(master?.saas_subscription_fee);
    const fee = !isNaN(rawFee) && rawFee > 0 ? rawFee : 100;
    const tillNumber = master?.saas_till_number?.trim() || master?.default_shortcode || "174379";
    const shortcodeType = master?.saas_shortcode_type === "paybill" ? "paybill" : "till";
    const paybillAccount = master?.saas_paybill_account || "SUBSCRIPTION";

    return {
      status: isActive ? "active" : (sub?.status ?? "inactive"),
      current_period_start: sub?.current_period_start ?? null,
      current_period_end: sub?.current_period_end ?? null,
      last_mpesa_receipt: sub?.last_mpesa_receipt ?? null,
      last_amount_paid: sub?.last_amount_paid ? Number(sub.last_amount_paid) : null,
      fee,
      tillNumber,
      shortcodeType,
      paybillAccount,
    };
  });

/** Triggers an M-Pesa STK push prompt on the user's phone for the monthly subscription fee. */
export const paySubscriptionMpesa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ phone: z.string().trim().min(9) }).parse(data))
  .handler(async ({ context, data }) => {
    const request = getRequest();
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;

    return paySaasSubscriptionStkPush(context.userId, data.phone, origin);
  });

/** Checks the M-Pesa STK push status for a subscription payment and activates access on success. */
export const checkSubscriptionPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ paymentId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    return checkAndSyncSubscriptionPayment(data.paymentId, context.userId);
  });

/** Confirms a manual M-Pesa receipt code to activate the user's subscription for 1 month. */
export const confirmManualMpesaPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ mpesaReceipt: z.string().trim().min(6) }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const master = await loadMasterCredentials();
    const rawFee = Number(master?.saas_subscription_fee);
    const fee = !isNaN(rawFee) && rawFee > 0 ? rawFee : 100;
    const code = data.mpesaReceipt.toUpperCase();

    await activateSubscriptionForUser(context.userId, fee, code);
    return { ok: true, receipt: code };
  });

/** Retrieves subscription payment attempts and history for the signed-in user. */
export const listSubscriptionPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const history = await query<{
      id: string;
      phone: string;
      amount: number | string;
      status: string;
      mpesa_receipt: string | null;
      checkout_request_id: string | null;
      result_code: string | null;
      result_desc: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, phone, amount, status, mpesa_receipt, checkout_request_id, result_code, result_desc, created_at, updated_at
       FROM public.subscription_payments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [context.userId],
    );
    return history;
  });
