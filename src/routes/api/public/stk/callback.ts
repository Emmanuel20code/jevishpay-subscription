import { createFileRoute } from "@tanstack/react-router";
import { query, queryOne } from "@/lib/db";

type CallbackItem = { Name: string; Value?: string | number };

export const Route = createFileRoute("/api/public/stk/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = (await request.json().catch(() => null)) as {
          Body?: {
            stkCallback?: {
              MerchantRequestID?: string;
              CheckoutRequestID?: string;
              ResultCode?: number;
              ResultDesc?: string;
              CallbackMetadata?: { Item?: CallbackItem[] };
            };
          };
        } | null;

        const callback = payload?.Body?.stkCallback;

        // Log raw payload into stk_callback_logs
        try {
          await query(
            `INSERT INTO public.stk_callback_logs (checkout_request_id, merchant_request_id, result_code, result_desc, raw_payload)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              callback?.CheckoutRequestID ?? null,
              callback?.MerchantRequestID ?? null,
              callback?.ResultCode !== undefined ? String(callback.ResultCode) : null,
              callback?.ResultDesc ?? null,
              JSON.stringify(payload ?? {}),
            ],
          );
        } catch (err) {
          console.error("Failed to insert callback log:", err);
        }

        if (!callback?.CheckoutRequestID) {
          return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Ignored" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const items = callback.CallbackMetadata?.Item ?? [];
        const receipt = items.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
        const succeeded = callback.ResultCode === 0;
        const status = succeeded
          ? "success"
          : callback.ResultCode === 1032
            ? "cancelled"
            : "failed";

        // Check if this callback matches a subscription payment
        const subPayment = await queryOne<{ id: string; user_id: string; amount: number }>(
          `SELECT id, user_id, amount FROM public.subscription_payments WHERE checkout_request_id = $1`,
          [callback.CheckoutRequestID],
        );

        if (subPayment) {
          await query(
            `UPDATE public.subscription_payments 
             SET status = $1, result_code = $2, result_desc = $3, mpesa_receipt = $4, updated_at = now()
             WHERE id = $5`,
            [
              status,
              String(callback.ResultCode ?? ""),
              callback.ResultDesc ?? null,
              receipt ? String(receipt) : null,
              subPayment.id,
            ],
          );

          if (succeeded) {
            try {
              const { activateSubscriptionForUser } = await import("@/lib/payments.server");
              await activateSubscriptionForUser(
                subPayment.user_id,
                Number(subPayment.amount),
                receipt ? String(receipt) : null,
              );
            } catch (err) {
              // Never fail the callback: the payment is recorded as success and
              // getMySubscription reconciles the activation on next load.
              console.error("Failed to activate subscription from callback:", err);
            }
          }
        } else {
          await query(
            `UPDATE public.transactions 
             SET status = $1, result_code = $2, result_desc = $3, mpesa_receipt = $4, updated_at = now()
             WHERE checkout_request_id = $5`,
            [
              status,
              String(callback.ResultCode ?? ""),
              callback.ResultDesc ?? null,
              receipt ? String(receipt) : null,
              callback.CheckoutRequestID,
            ],
          );
        }

        return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
