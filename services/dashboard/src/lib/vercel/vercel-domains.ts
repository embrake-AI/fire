import { Vercel } from "@vercel/sdk";

const vercel = new Vercel({ bearerToken: process.env.VERCEL_TOKEN });
const projectId = process.env.VERCEL_STATUS_PROJECT_ID!;

export type DomainConfig = {
	verified: boolean;
	misconfigured: boolean;
};

export async function addDomainToVercel(domain: string): Promise<void> {
	await vercel.projects.addProjectDomain({
		idOrName: projectId,
		requestBody: { name: domain },
	});
}

export async function removeDomainFromVercel(domain: string): Promise<void> {
	try {
		await vercel.projects.removeProjectDomain({
			idOrName: projectId,
			domain,
		});
	} catch (error) {
		// Ignore 404 errors (domain already removed or never existed)
		if (error instanceof Error && error.message.includes("404")) {
			return;
		}
		throw error;
	}
}

export async function getDomainConfig(domain: string): Promise<DomainConfig> {
	// Get domain details from project to check ownership verification
	const domainInfo = await vercel.projects.getProjectDomain({
		idOrName: projectId,
		domain,
	});

	// Get DNS configuration status
	const config = await vercel.domains.getDomainConfig({ domain });

	// Domain is only fully verified when:
	// 1. Ownership is verified (no verification needed)
	// 2. DNS is properly configured (not misconfigured)
	const ownershipVerified = domainInfo.verified === true;
	const dnsConfigured = !config.misconfigured;

	return {
		verified: ownershipVerified && dnsConfigured,
		misconfigured: !ownershipVerified || config.misconfigured,
	};
}
