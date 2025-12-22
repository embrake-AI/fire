export const IS_STATUS = ["open", "mitigating", "resolved"] as const;
type IS_STATUS = (typeof IS_STATUS)[number];

export const IS_SEVERITY = ["low", "medium", "high"] as const;
type IS_SEVERITY = (typeof IS_SEVERITY)[number];

export const IS_SOURCE = ["slack", "dashboard"] as const;
type IS_SOURCE = (typeof IS_SOURCE)[number];

export type IS = {
	id: string;
	createdAt: Date;
	status: IS_STATUS;
	prompt: string;
	severity: IS_SEVERITY;
	createdBy?: string;
	assignee: string;
	source: IS_SOURCE;
	title: string;
	description: string;
};
