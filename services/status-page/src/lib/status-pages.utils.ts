export function normalizeDomain(input: string | null | undefined): string | null {
	if (!input) return null;
	let domain = input.trim().toLowerCase();
	if (!domain) return null;

	if (domain.startsWith("http://") || domain.startsWith("https://")) {
		try {
			domain = new URL(domain).host;
		} catch {
			return null;
		}
	}

	domain = domain.split(/[/?#]/)[0] ?? "";
	if (!domain) return null;

	if (domain.includes(":")) {
		domain = domain.split(":")[0] ?? "";
	}

	domain = domain.replace(/\.+$/, "");
	return domain || null;
}
