import { axiosInstance } from "@/utils/axiosInstance";
import type { SourceErrorMode, SourceErrorSettings } from "@/lib/sources";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type SourceErrorSettingsPatch = {
	mode?: SourceErrorMode;
	captureGlobalErrors?: boolean;
	breadcrumbsEnabled?: boolean;
	samplingRate?: number;
	release?: string | null;
};

async function updateErrorSettings(
	slug: string | undefined,
	sourceId: string | undefined,
	patch: SourceErrorSettingsPatch,
) {
	const response = await axiosInstance.patch(
		`/projects/${slug}/sources/${sourceId}/error-settings`,
		patch,
	);
	return response.data as SourceErrorSettings;
}

/** Per-source error collection config (owner/admin only server-side). */
export function useUpdateErrorSettingsMutation(
	slug: string | undefined,
	sourceId: string | undefined,
) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: SourceErrorSettingsPatch) =>
			updateErrorSettings(slug, sourceId, patch),
		onSuccess: (saved) => {
			if (slug && sourceId) {
				queryClient.setQueryData(["source-error-settings", slug, sourceId], saved);
			}
		},
	});
}