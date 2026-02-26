const AFFECTION_STATUS_ORDER = ["investigating", "mitigating", "resolved"] as const;

export type AffectionStatus = (typeof AFFECTION_STATUS_ORDER)[number];
export type AffectionImpact = "partial" | "major";

function getAffectionStatusIndex(status: AffectionStatus) {
	return AFFECTION_STATUS_ORDER.indexOf(status);
}

export function normalizeAffectionStatus(status?: AffectionStatus) {
	return status && AFFECTION_STATUS_ORDER.includes(status) ? status : undefined;
}

export function filterAffectionServices(services: { id: string; impact: AffectionImpact }[] | undefined, allowedServiceIds: Set<string>) {
	return Array.isArray(services) ? services.filter((service) => allowedServiceIds.has(service.id)) : [];
}

export function validateAffectionUpdate({
	trimmedMessage,
	hasAffection,
	hasTitle,
	hasServices,
	normalizedStatus,
	currentStatus,
}: {
	trimmedMessage: string;
	hasAffection: boolean;
	hasTitle: boolean;
	hasServices: boolean;
	normalizedStatus?: AffectionStatus;
	currentStatus?: AffectionStatus | null;
}): { error: string } | undefined {
	if (!trimmedMessage) {
		return { error: "MESSAGE_REQUIRED" };
	}

	if (!hasAffection) {
		if (!hasTitle) {
			return { error: "TITLE_REQUIRED" };
		}
		if (!hasServices) {
			return { error: "SERVICES_REQUIRED" };
		}
		if (normalizedStatus !== "investigating") {
			return { error: "INITIAL_STATUS_REQUIRED" };
		}
	}

	if (normalizedStatus && hasAffection) {
		const currentIndex = getAffectionStatusIndex(currentStatus ?? "investigating");
		const nextIndex = getAffectionStatusIndex(normalizedStatus);
		if (nextIndex <= currentIndex) {
			return { error: "STATUS_CAN_ONLY_MOVE_FORWARD" };
		}
	}

	return undefined;
}
