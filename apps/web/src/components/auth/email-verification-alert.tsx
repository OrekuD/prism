import { Loader2, TriangleAlert } from "lucide-react";

import { authClient } from "@/lib/authClient";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";

export function EmailVerificationAlert() {
	const { data: sessionData } = authClient.useSession();
	const { resend, isPending } = useResendVerificationEmail();

	if (sessionData?.user?.emailVerified) return null;

	return (
		<div className="mb-4 flex items-center gap-2.5 rounded-[12px] border border-warning/30 bg-warning/10 px-3 py-2.5">
			<TriangleAlert
				className="size-3.5 shrink-0 text-warning"
				aria-hidden="true"
			/>
			<p className="min-w-0 flex-1 text-[13px] text-text">
				Verify your email to create workspaces and projects.
			</p>
			<button
				type="button"
				disabled={isPending}
				aria-busy={isPending}
				onClick={() => {
					if (sessionData?.user?.email) void resend(sessionData.user.email);
				}}
				className="shrink-0 text-[13px] font-medium text-warning underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
			>
				{isPending ? (
					<Loader2
						className="mr-1 inline size-3.5 animate-spin align-[-2px]"
						aria-hidden="true"
					/>
				) : null}
				Resend verification email
			</button>
		</div>
	);
}
