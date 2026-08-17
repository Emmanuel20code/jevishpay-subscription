// Server-only business logic for merchant settings, API keys, STK pushes and M-Pesa SaaS subscriptions.
import { query, queryOne } from "./db";
import {
  getDarajaConfig,
  initiateStkPush,
  normalizePhone,
  queryStkPushStatus,
} from "./mpesa.server";
import { ensureSaasSchema } from "./saas-schema";

export async function hashApiKey(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(): { raw: string; prefix: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const raw = `jp_live_${body}`;
  return { raw, prefix: raw.slice(0, 12) };
}

export type PushInput = {
  phone: string;
  amount: number;
  accountReference?: string | undefined;
  description?: string | undefined;
};

export async function loadMasterCredentials() {
  await ensureSaasSchema();
  return queryOne<{
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
  }>(`SELECT * FROM public.platform_credentials WHERE id = true`);
}

export async function checkActiveSubscription(userId: string): Promise<boolean> {
  await ensureSaasSchema();

  // Super admin accounts always have access
  const admin = await queryOne<{ id: string }>(
    `SELECT id FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
    [userId],
  );
  if (admin) {
    console.log(`[checkActiveSubscription] User ${userId} is admin. Granting access.`);
    return true;
  }

  const sub = await queryOne<{
    status: string | null;
    current_period_end: string | null;
  }>(`SELECT status, current_period_end FROM public.subscriptions WHERE user_id = $1`, [userId]);

  if (!sub) {
    console.log(`[checkActiveSubscription] User ${userId} has no subscription record.`);
    return false;
  }

  // Check 1 month period expiration
  if (sub.current_period_end) {
    const endDate = new Date(sub.current_period_end);
    console.log(
      `[checkActiveSubscription] User ${userId} subscription end date read from DB: ${endDate.toISOString()} (Current Date: ${new Date().toISOString()})`,
    );
    if (endDate.getTime() < Date.now()) {
      console.log(`[checkActiveSubscription] User ${userId} subscription expired. Suspending...`);
      // Automatically suspend access when past due date
      if (sub.status === "active") {
        await query(
          `UPDATE public.subscriptions SET status = 'suspended', updated_at = now() WHERE user_id = $1`,
          [userId],
        );
      }
      return false;
    }
  } else {
    console.log(`[checkActiveSubscription] User ${userId} has no current_period_end set.`);
  }

  console.log(`[checkActiveSubscription] User ${userId} subscription is active.`);
  return sub.status === "active" || sub.status === "trialing";
}

export async function activateSubscriptionForUser(
  userId: string,
  amount: number = 100,
  mpesaReceipt?: string | null,
) {
  await ensureSaasSchema();

  const profile = await queryOne<{ email: string }>(
    `SELECT email FROM public.profiles WHERE id = $1`,
    [userId],
  );

  console.log(
    `[activateSubscriptionForUser] Activating 1 month for user ${userId}. Amount: ${amount}, Receipt: ${mpesaReceipt || "none"}`,
  );

  await query(
    `INSERT INTO public.subscriptions (user_id, email, status, current_period_start, current_period_end, last_mpesa_receipt, last_amount_paid, updated_at)
     VALUES ($1, $2, 'active', now(), now() + interval '1 month', $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'active',
       current_period_start = now(),
       current_period_end = now() + interval '1 month',
       last_mpesa_receipt = COALESCE($3, public.subscriptions.last_mpesa_receipt),
       last_amount_paid = COALESCE($4, public.subscriptions.last_amount_paid),
       updated_at = now()`,
    [userId, profile?.email ?? null, mpesaReceipt ?? null, amount],
  );

  const savedSub = await queryOne<{ current_period_end: string }>(
    `SELECT current_period_end FROM public.subscriptions WHERE user_id = $1`,
    [userId],
  );
  console.log(
    `[activateSubscriptionForUser] DB successfully wrote current_period_end: ${savedSub?.current_period_end}`,
  );
}

/**
 * Self-healing: if a subscription payment succeeded but the subscription row was
 * never activated (e.g. the callback failed), activate it from the payment record.
 */
export async function reconcileSubscriptionFromPayments(userId: string) {
  await ensureSaasSchema();

  const pending = await queryOne<{
    id: string;
    amount: number | string;
    mpesa_receipt: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.amount, p.mpesa_receipt, p.created_at
       FROM public.subscription_payments p
       LEFT JOIN public.subscriptions s ON s.user_id = p.user_id
      WHERE p.user_id = $1
        AND p.status = 'success'
        AND p.created_at > now() - interval '1 month'
        AND (s.current_period_end IS NULL OR s.current_period_end < p.created_at)
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [userId],
  );

  if (!pending) return false;

  console.log(
    `[reconcileSubscriptionFromPayments] Activating user ${userId} from successful payment ${pending.id}`,
  );
  await activateSubscriptionForUser(userId, Number(pending.amount), pending.mpesa_receipt);
  return true;
}

export async function paySaasSubscriptionStkPush(
  userId: string,
  phoneInput: string,
  origin: string,
) {
  await ensureSaasSchema();

  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error("Enter a valid Kenyan phone number (e.g., 0712345678)");

  const master = await loadMasterCredentials();
  const config = getDarajaConfig(master);

  const saasTill = master?.saas_till_number?.trim() || config.shortcode;
  const accountType = master?.saas_shortcode_type === "paybill" ? "paybill" : "till";
  const accountRef = master?.saas_paybill_account || "SUBSCRIPTION";
  const rawFee = Number(master?.saas_subscription_fee);
  const fee = !isNaN(rawFee) && rawFee > 0 ? rawFee : 100;

  const callbackUrl = master?.default_callback_url || `${origin}/api/public/stk/callback`;

  const subPayment = await queryOne<{ id: string }>(
    `INSERT INTO public.subscription_payments (user_id, phone, amount, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', now(), now())
     RETURNING id`,
    [userId, phone, fee],
  );

  if (!subPayment) throw new Error("Could not create subscription payment record");

  try {
    const result = await initiateStkPush(config, {
      phone,
      amount: fee,
      shortcode: config.shortcode,
      passkey: config.passkey,
      partyB: saasTill,
      accountType,
      accountReference: accountRef,
      description: `JevishPay 1 Month Subscription KES ${fee}`,
      callbackUrl,
    });

    const body = result.body as Record<string, string | undefined>;
    console.log(
      `[paySaasSubscriptionStkPush] Raw STK Push initiation response for user ${userId}:`,
      body,
    );

    if (!result.ok || body["ResponseCode"] !== "0") {
      const errorMessage =
        body["errorMessage"] ?? body["ResponseDescription"] ?? "M-Pesa STK push rejected";
      console.warn(
        `[paySaasSubscriptionStkPush] Safaricom rejected STK Push synchronously. Reason: ${errorMessage}`,
      );
      await query(
        `UPDATE public.subscription_payments SET status = 'failed', result_desc = $1, updated_at = now() WHERE id = $2`,
        [errorMessage, subPayment.id],
      );
      throw new Error(errorMessage);
    }

    console.log(
      `[paySaasSubscriptionStkPush] Safaricom accepted STK Push. CheckoutRequestID: ${body["CheckoutRequestID"]}`,
    );

    await query(
      `UPDATE public.subscription_payments
       SET merchant_request_id = $1, checkout_request_id = $2, result_desc = $3, updated_at = now()
       WHERE id = $4`,
      [
        body["MerchantRequestID"] ?? null,
        body["CheckoutRequestID"] ?? null,
        body["CustomerMessage"] ?? null,
        subPayment.id,
      ],
    );

    return {
      paymentId: subPayment.id,
      checkoutRequestId: body["CheckoutRequestID"] ?? null,
      message: body["CustomerMessage"] ?? "STK push sent to your phone",
      amount: fee,
      tillNumber: saasTill,
    };
  } catch (error) {
    await query(
      `UPDATE public.subscription_payments SET status = 'failed', result_desc = $1, updated_at = now() WHERE id = $2`,
      [error instanceof Error ? error.message : "Unknown error", subPayment.id],
    );
    throw error;
  }
}

export async function checkAndSyncSubscriptionPayment(paymentId: string, userId: string) {
  await ensureSaasSchema();

  const payment = await queryOne<{
    id: string;
    user_id: string;
    amount: number | string;
    status: string;
    checkout_request_id: string | null;
  }>(
    `SELECT id, user_id, amount, status, checkout_request_id FROM public.subscription_payments WHERE id = $1 AND user_id = $2`,
    [paymentId, userId],
  );

  if (!payment) throw new Error("Subscription payment record not found");
  if (payment.status !== "pending" || !payment.checkout_request_id) {
    return payment;
  }

  const master = await loadMasterCredentials();
  const config = getDarajaConfig(master);

  const queryRes = await queryStkPushStatus(config, {
    shortcode: config.shortcode,
    passkey: config.passkey,
    checkoutRequestId: payment.checkout_request_id,
  });

  const body = queryRes.body as Record<string, unknown>;
  console.log(
    `[checkAndSyncSubscriptionPayment] Raw STK push status response body for payment ${paymentId}:`,
    body,
  );

  const resultCode = body["ResultCode"] !== undefined ? String(body["ResultCode"]) : null;
  const resultDesc =
    (body["ResultDesc"] as string | undefined) ||
    (body["ResponseDescription"] as string | undefined) ||
    null;

  console.log(
    `[checkAndSyncSubscriptionPayment] Parsed ResultCode: ${resultCode}, ResultDesc: ${resultDesc}`,
  );

  if (resultCode === "0") {
    console.log(
      `[checkAndSyncSubscriptionPayment] Payment ${paymentId} SUCCESS (ResultCode 0). Proceeding to activate subscription.`,
    );
    await query(
      `UPDATE public.subscription_payments
       SET status = 'success', result_code = $1, result_desc = $2, updated_at = now()
       WHERE id = $3`,
      [resultCode, resultDesc, payment.id],
    );

    // Automatically activate user's subscription for 1 month!
    await activateSubscriptionForUser(payment.user_id, Number(payment.amount), null);
  } else if (resultCode === "1032") {
    console.warn(
      `[checkAndSyncSubscriptionPayment] Payment ${paymentId} CANCELLED by user (ResultCode 1032).`,
    );
    await query(
      `UPDATE public.subscription_payments
       SET status = 'cancelled', result_code = $1, result_desc = $2, updated_at = now()
       WHERE id = $3`,
      [resultCode, resultDesc, payment.id],
    );
  } else if (resultCode && resultCode !== "0") {
    console.warn(
      `[checkAndSyncSubscriptionPayment] Payment ${paymentId} non-zero Daraja ResultCode ${resultCode}: ${resultDesc}`,
    );
    await query(
      `UPDATE public.subscription_payments
       SET status = 'failed', result_code = $1, result_desc = $2, updated_at = now()
       WHERE id = $3`,
      [resultCode, resultDesc, payment.id],
    );
  } else {
    console.log(
      `[checkAndSyncSubscriptionPayment] Payment ${paymentId} PENDING. Safaricom has not completed processing yet (ResultCode is null/undefined).`,
    );
  }

  const updated = await queryOne(
    `SELECT id, phone, amount, status, mpesa_receipt, result_desc, created_at FROM public.subscription_payments WHERE id = $1`,
    [payment.id],
  );
  return updated;
}

export async function runStkPush(
  userId: string,
  input: PushInput,
  apiKeyId: string | null,
  origin: string,
) {
  const hasSub = await checkActiveSubscription(userId);
  if (!hasSub) {
    throw new Error(
      "Active subscription required. Please subscribe to an active monthly plan to use payments.",
    );
  }

  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Enter a valid Kenyan phone number");
  if (!(input.amount >= 1)) throw new Error("Amount must be at least KES 1");

  const settings = await queryOne<{ shortcode: string; account_type: string }>(
    `SELECT shortcode, account_type FROM public.merchant_settings WHERE user_id = $1`,
    [userId],
  );

  const merchantShortcode = settings?.shortcode?.trim();
  if (!merchantShortcode) {
    throw new Error(
      "No till or paybill number configured for this merchant account. Add it in Merchant settings first.",
    );
  }
  const accountType = settings?.account_type === "till" ? "till" : "paybill";

  const master = await loadMasterCredentials();
  const config = getDarajaConfig(master);

  const initiatorShortcode = config.shortcode;
  const initiatorPasskey = config.passkey;
  const accountReference = input.accountReference || merchantShortcode;
  const description = input.description || "Payment";
  const callbackUrl = master?.default_callback_url || `${origin}/api/public/stk/callback`;

  const tx = await queryOne<{ id: string }>(
    `INSERT INTO public.transactions (user_id, api_key_id, phone, amount, account_reference, description, shortcode, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', now(), now())
     RETURNING id`,
    [userId, apiKeyId, phone, input.amount, accountReference, description, merchantShortcode],
  );

  if (!tx) throw new Error("Could not record transaction");

  try {
    const result = await initiateStkPush(config, {
      phone,
      amount: input.amount,
      shortcode: initiatorShortcode,
      passkey: initiatorPasskey,
      partyB: merchantShortcode,
      accountType,
      accountReference,
      description,
      callbackUrl,
    });

    const body = result.body as Record<string, string | undefined>;
    console.log(`[runStkPush] Raw STK Push initiation response for transaction ${tx.id}:`, body);

    if (!result.ok || body["ResponseCode"] !== "0") {
      const errorMessage =
        body["errorMessage"] ?? body["ResponseDescription"] ?? "Daraja rejected the request";
      console.warn(
        `[runStkPush] Safaricom rejected STK Push synchronously. Reason: ${errorMessage}`,
      );
      await query(
        `UPDATE public.transactions SET status = 'failed', result_desc = $1, updated_at = now() WHERE id = $2`,
        [errorMessage, tx.id],
      );
      throw new Error(errorMessage);
    }

    console.log(
      `[runStkPush] Safaricom accepted STK Push. CheckoutRequestID: ${body["CheckoutRequestID"]}`,
    );

    await query(
      `UPDATE public.transactions 
       SET merchant_request_id = $1, checkout_request_id = $2, result_desc = $3, updated_at = now() 
       WHERE id = $4`,
      [
        body["MerchantRequestID"] ?? null,
        body["CheckoutRequestID"] ?? null,
        body["CustomerMessage"] ?? null,
        tx.id,
      ],
    );

    return {
      transactionId: tx.id,
      checkoutRequestId: body["CheckoutRequestID"] ?? null,
      message: body["CustomerMessage"] ?? "STK push sent",
    };
  } catch (error) {
    await query(
      `UPDATE public.transactions SET status = 'failed', result_desc = $1, updated_at = now() WHERE id = $2`,
      [error instanceof Error ? error.message : "Unknown error", tx.id],
    );
    throw error;
  }
}

export async function checkAndSyncTransactionStatus(transactionId: string, userId?: string) {
  const tx = await queryOne<{
    id: string;
    user_id: string;
    status: string;
    checkout_request_id: string | null;
  }>(
    `SELECT id, user_id, status, checkout_request_id FROM public.transactions WHERE id = $1 ${
      userId ? "AND user_id = $2" : ""
    }`,
    userId ? [transactionId, userId] : [transactionId],
  );

  if (!tx) throw new Error("Transaction not found");
  if (tx.status !== "pending" || !tx.checkout_request_id) {
    return tx;
  }

  const master = await loadMasterCredentials();
  const config = getDarajaConfig(master);

  const queryRes = await queryStkPushStatus(config, {
    shortcode: config.shortcode,
    passkey: config.passkey,
    checkoutRequestId: tx.checkout_request_id,
  });

  const body = queryRes.body as Record<string, unknown>;
  console.log(
    `[checkAndSyncTransactionStatus] Raw STK push status response body for tx ${transactionId}:`,
    body,
  );

  const resultCode = body["ResultCode"] !== undefined ? String(body["ResultCode"]) : null;
  const resultDesc =
    (body["ResultDesc"] as string | undefined) ||
    (body["ResponseDescription"] as string | undefined) ||
    null;

  console.log(
    `[checkAndSyncTransactionStatus] Parsed ResultCode: ${resultCode}, ResultDesc: ${resultDesc}`,
  );

  if (resultCode === "0") {
    console.log(
      `[checkAndSyncTransactionStatus] Transaction ${transactionId} SUCCESS (ResultCode 0).`,
    );
    await query(
      `UPDATE public.transactions 
       SET status = 'success', result_code = $1, result_desc = $2, updated_at = now() 
       WHERE id = $3`,
      [resultCode, resultDesc, tx.id],
    );
  } else if (resultCode === "1032") {
    console.warn(
      `[checkAndSyncTransactionStatus] Transaction ${transactionId} CANCELLED by user (ResultCode 1032).`,
    );
    await query(
      `UPDATE public.transactions 
       SET status = 'cancelled', result_code = $1, result_desc = $2, updated_at = now() 
       WHERE id = $3`,
      [resultCode, resultDesc, tx.id],
    );
  } else if (resultCode && resultCode !== "0") {
    console.warn(
      `[checkAndSyncTransactionStatus] Transaction ${transactionId} non-zero Daraja ResultCode ${resultCode}: ${resultDesc}`,
    );
    await query(
      `UPDATE public.transactions 
       SET status = 'failed', result_code = $1, result_desc = $2, updated_at = now() 
       WHERE id = $3`,
      [resultCode, resultDesc, tx.id],
    );
  } else {
    console.log(
      `[checkAndSyncTransactionStatus] Transaction ${transactionId} PENDING. Safaricom has not completed processing yet.`,
    );
  }

  const updated = await queryOne(
    `SELECT id, phone, amount, status, account_reference, description, mpesa_receipt, result_desc, created_at FROM public.transactions WHERE id = $1`,
    [tx.id],
  );
  return updated;
}
