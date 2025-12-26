// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{ts,tsx,js,jsx,html}"],
	theme: {
		extend: {
			keyframes: {
				"collapsible-down": {
					from: { height: "0" },
					to: { height: "var(--kb-collapsible-content-height)" },
				},
				"collapsible-up": {
					from: { height: "var(--kb-collapsible-content-height)" },
					to: { height: "0" },
				},
			},
			animation: {
				"collapsible-down": "collapsible-down 300ms ease-out",
				"collapsible-up": "collapsible-up 300ms ease-out",
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
};
