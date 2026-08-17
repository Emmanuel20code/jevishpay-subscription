import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getMySubscription,
  paySubscriptionMpesa,
  checkSubscriptionPaymentStatus,
  confirmManualMpesaPayment,
} from "@/lib/subscription.functions";

/**
 * Dedicated SubscriptionService hook that centralizes the fetching of subscription
 * pricing, status, and payment mutations as a single source of truth updated by admin settings.
 */
export function useSubscriptionService() {
  const queryClient = useQueryClient();
  const fetchSubscription = useServerFn(getMySubscription);
  const triggerStk = useServerFn(paySubscriptionMpesa);
  const checkStatusFn = useServerFn(checkSubscriptionPaymentStatus);
  const confirmCodeFn = useServerFn(confirmManualMpesaPayment);

  const subscriptionQuery = useQuery({
    queryKey: ["subscription"],
    queryFn: () => fetchSubscription(),
    refetchOnWindowFocus: true,
  });

  const payMutation = useMutation({
    mutationFn: (args: string | { phone: string }) => {
      const phone = typeof args === "string" ? args.trim() : args.phone.trim();
      return triggerStk({ data: { phone } });
    },
    onSuccess: (data) => {
      toast.success(data.message || "STK Push sent to your phone!");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to initiate M-Pesa payment";
      if (msg.includes("bad debt contract") || msg.includes("E3008")) {
        toast.error(
          "M-Pesa rejected the number: The phone number has a bad debt contract restriction in Safaricom's system. Please try another phone number or activate via Admin.",
        );
      } else {
        toast.error(msg);
      }
    },
  });

  const confirmCodeMutation = useMutation({
    mutationFn: (receipt: string) => confirmCodeFn({ data: { mpesaReceipt: receipt } }),
    onSuccess: (data) => {
      toast.success(`M-Pesa receipt ${data.receipt} confirmed! 1 month subscription active.`);
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not verify receipt code");
    },
  });

  return {
    subscription: subscriptionQuery.data,
    isLoading: subscriptionQuery.isLoading,
    isError: subscriptionQuery.isError,
    error: subscriptionQuery.error,
    refetch: subscriptionQuery.refetch,
    isRefetching: subscriptionQuery.isRefetching,
    payStk: payMutation.mutateAsync,
    isPaying: payMutation.isPending,
    confirmManualCode: confirmCodeMutation.mutateAsync,
    isConfirming: confirmCodeMutation.isPending,
    checkStatus: (paymentId: string) => checkStatusFn({ data: { paymentId } }),
  };
}
