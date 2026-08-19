import { axiosInstance } from "@/utils/axiosInstance";
import type { SourceErrorSettings } from "@/lib/sources";
import { useQuery } from "@tanstack/react-query";

/**
 * Per-source error collection config + live status (task-15 item 440).
 * Member-readable; defaults are returned when the source has no settings
 * row, and the status (last error seen, 30-day count) always comes from
 * ingestion.
 */
async function sourceErrorSettings(
	slug: string | undefined,
	sourceId: string | undefined,
) {
	if (!slug || !sourceId) return null;
	const response = await axiosInstance.get(
		`/projects/${slug}/sources/${sourceId}/error-settings`,
	);
	if (response.status === 200) {
		return response.data as SourceErrorSettings;
	}
	return null;
}

export function useSourceErrorSettingsQuery(
	slug: string | undefined,
	sourceId: string | undefined,
) {
	return useQuery({
		queryKey: ["source-error-settings", slug, sourceId],
		queryFn: () => sourceErrorSettings(slug, sourceId),
		enabled: Boolean(slug && sourceId),
		refetchOnWindowFocus: false,
	});
}