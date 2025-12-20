import { CircleAlert, Info, TriangleAlert } from "lucide-solid";
import type { JSX } from "solid-js";
import type { Incident } from "./incidents";

export type Severity = Incident["severity"];
export type Status = Incident["status"];

interface SeverityConfig {
	icon: (size: "sm" | "md") => JSX.Element;
	color: string;
	bg: string;
	border: string;
	label: string;
}

interface StatusConfig {
	label: string;
	color: string;
	bg: string;
	dot: string;
}

const iconSizes = {
	sm: "w-5 h-5",
	md: "w-6 h-6",
} as const;

export const severityConfig: Record<Severity, SeverityConfig> = {
	high: {
		icon: (size) => <TriangleAlert class={iconSizes[size]} />,
		color: "text-red-600",
		bg: "bg-red-50",
		border: "border-red-200",
		label: "High",
	},
	medium: {
		icon: (size) => <CircleAlert class={iconSizes[size]} />,
		color: "text-amber-600",
		bg: "bg-amber-50",
		border: "border-amber-200",
		label: "Medium",
	},
	low: {
		icon: (size) => <Info class={iconSizes[size]} />,
		color: "text-blue-600",
		bg: "bg-blue-50",
		border: "border-blue-200",
		label: "Low",
	},
};

export const statusConfig: Record<Status, StatusConfig> = {
	open: {
		label: "Open",
		color: "text-red-600",
		bg: "bg-red-100",
		dot: "bg-red-500",
	},
	mitigating: {
		label: "Mitigating",
		color: "text-amber-600",
		bg: "bg-amber-100",
		dot: "bg-amber-500",
	},
	resolved: {
		label: "Resolved",
		color: "text-emerald-600",
		bg: "bg-emerald-100",
		dot: "bg-emerald-500",
	},
};

export function getSeverity(severity: Severity) {
	return severityConfig[severity];
}

export function getStatus(status: Status) {
	return statusConfig[status];
}
