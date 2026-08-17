CREATE TABLE IF NOT EXISTS public.stk_callback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_request_id text,
  merchant_request_id text,
  result_code text,
  result_desc text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stk_callback_logs_checkout ON public.stk_callback_logs(checkout_request_id);
