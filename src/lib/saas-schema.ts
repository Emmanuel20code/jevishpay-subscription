import { query } from "./db";

let schemaInitialized = false;

export async function ensureSaasSchema() {
  if (schemaInitialized) return;

  try {
    // 1. Ensure platform_credentials table columns for SaaS M-Pesa & GitHub sync settings
    await query(`
      ALTER TABLE public.platform_credentials 
      ADD COLUMN IF NOT EXISTS saas_till_number text,
      ADD COLUMN IF NOT EXISTS saas_shortcode_type text DEFAULT 'till',
      ADD COLUMN IF NOT EXISTS saas_paybill_account text DEFAULT 'SUBSCRIPTION',
      ADD COLUMN IF NOT EXISTS saas_subscription_fee numeric(12,2) DEFAULT 100.00,
      ADD COLUMN IF NOT EXISTS github_repo_url text DEFAULT 'https://github.com/Emmanuel20code/jevishpay-subscription.git',
      ADD COLUMN IF NOT EXISTS github_branch text DEFAULT 'main',
      ADD COLUMN IF NOT EXISTS github_token text,
      ADD COLUMN IF NOT EXISTS github_last_pushed_at timestamptz,
      ADD COLUMN IF NOT EXISTS github_last_commit_hash text,
      ADD COLUMN IF NOT EXISTS github_last_commit_msg text;
    `);

    // 2. Ensure public.subscriptions table
    await query(`
      CREATE TABLE IF NOT EXISTS public.subscriptions (
        user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        email text,
        status text NOT NULL DEFAULT 'inactive',
        current_period_start timestamptz,
        current_period_end timestamptz,
        last_mpesa_receipt text,
        last_amount_paid numeric(12,2),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 2b. Ensure M-Pesa columns exist on a pre-existing subscriptions table
    //     (legacy Stripe-shaped tables lack these, which made activation fail)
    await query(`
      ALTER TABLE public.subscriptions
      ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'inactive',
      ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
      ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
      ADD COLUMN IF NOT EXISTS last_mpesa_receipt text,
      ADD COLUMN IF NOT EXISTS last_amount_paid numeric(12,2),
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    // 3. Ensure public.subscription_payments table
    await query(`
      CREATE TABLE IF NOT EXISTS public.subscription_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        phone text NOT NULL,
        amount numeric(12,2) NOT NULL DEFAULT 100.00,
        status text NOT NULL DEFAULT 'pending',
        checkout_request_id text,
        merchant_request_id text,
        mpesa_receipt text,
        result_code text,
        result_desc text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_sub_payments_checkout ON public.subscription_payments(checkout_request_id);
      CREATE INDEX IF NOT EXISTS idx_sub_payments_user ON public.subscription_payments(user_id, created_at DESC);
    `);

    schemaInitialized = true;
  } catch (err) {
    console.error("Failed to initialize SaaS database schema:", err);
  }
}
