import { useCallback, useState } from "react";
import { toast } from "sonner";
import { resendVerificationEmail } from "@/lib/authClient";

/**
 * Resend-verification-email action with pending state and toast feedback,
 * shared by the dashboard banner and the account authentication page.
 */
export function useResendVerificationEmail() {
  const [isPending, setIsPending] = useState(false);

  const resend = useCallback(async (email: string) => {
    setIsPending(true);
    try {
      await resendVerificationEmail(email);
      toast.success("Verification email sent — check your inbox (and spam).");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send the verification email.",
      );
    } finally {
      setIsPending(false);
    }
  }, []);

  return { resend, isPending };
}
