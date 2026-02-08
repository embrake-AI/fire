import { getStatusDescription, type StatusSnapshotData } from "./status-pages.server";

const STATUS_API_CACHE_CONTROL = "public, max-age=3, stale-while-revalidate=30, stale-if-error=3600";
const STATUS_API_CDN_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=30, stale-if-error=3600";
const STATUS_API_CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export type StatusSnapshotApiPayload = {
	updated_at: string;
	status: {
		indicator: "none" | "minor" | "major";
		description: string;
	};
	version: string;
};

function buildSnapshotPayload(snapshot: StatusSnapshotData): StatusSnapshotApiPayload {
	const indicator: "none" | "minor" | "major" = snapshot.activeMajorIncidentCount > 0 ? "major" : snapshot.activeIncidentCount > 0 ? "minor" : "none";

	return {
		updated_at: snapshot.lastUpdatedAt.toISOString(),
		status: {
			indicator,
			description: getStatusDescription(indicator),
		},
		version: snapshot.version,
	};
}

export function buildStatusSnapshotResponse(options: { snapshot: StatusSnapshotData; ifNoneMatch?: string | null }): Response {
	const { snapshot, ifNoneMatch } = options;
	const etag = `"${snapshot.version}"`;

	if (ifNoneMatch === etag) {
		return new Response(null, {
			status: 304,
			headers: {
				...STATUS_API_CORS_HEADERS,
				"Cache-Control": STATUS_API_CACHE_CONTROL,
				"CDN-Cache-Control": STATUS_API_CDN_CACHE_CONTROL,
				"Vercel-CDN-Cache-Control": STATUS_API_CDN_CACHE_CONTROL,
				ETag: etag,
				"Last-Modified": snapshot.lastUpdatedAt.toUTCString(),
			},
		});
	}

	const payload = buildSnapshotPayload(snapshot);
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: {
			...STATUS_API_CORS_HEADERS,
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": STATUS_API_CACHE_CONTROL,
			"CDN-Cache-Control": STATUS_API_CDN_CACHE_CONTROL,
			"Vercel-CDN-Cache-Control": STATUS_API_CDN_CACHE_CONTROL,
			ETag: etag,
			"Last-Modified": snapshot.lastUpdatedAt.toUTCString(),
		},
	});
}
