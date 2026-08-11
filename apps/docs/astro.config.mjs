import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";

/**
 * Prism documentation (task-8).
 *
 * - `site` is the canonical hosted-docs origin. Self-hosted operators build
 *   with `ASTRO_SITE` to override canonical/sitemap URLs so a private
 *   instance never points at a public origin.
 * - The header logo is the canonical Task 7 SVG, inlined by the Header
 *   override (src/components/Header.astro).
 */
export default defineConfig({
	site: process.env.ASTRO_SITE || "https://docs.prism.sh",
	trailingSlash: "always",
	integrations: [
		starlight({
			title: "Prism Docs",
			description:
				"Documentation for Prism — realtime product analytics for teams, hosted or self-hosted.",
			components: {
				Header: "./src/components/Header.astro",
				Footer: "./src/components/Footer.astro",
				PageTitle: "./src/components/PageTitle.astro",
			},
			credits: false,
			// Custom branded 404 lives at src/pages/404.astro.
			disable404Route: true,
			customCss: ["./src/styles/prism.css"],
			lastUpdated: true,
			editLink: {
				baseUrl: "https://github.com/OrekuD/prism/edit/main/apps/docs",
			},
			head: [
				{
					tag: "meta",
					attrs: {
						name: "theme-color",
						content: "#050506",
						media: "(prefers-color-scheme: dark)",
					},
				},
				{
					tag: "meta",
					attrs: {
						name: "theme-color",
						content: "#F6F6F8",
						media: "(prefers-color-scheme: light)",
					},
				},
				{
					tag: "meta",
					attrs: { property: "og:type", content: "website" },
				},
				{
					tag: "meta",
					attrs: { property: "og:site_name", content: "Prism Docs" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image", content: "/og-image.png" },
				},
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
				// Content-Security-Policy: static docs, no unsafe-eval.
				// - style-src 'unsafe-inline': Astro emits inline <style>
				//   blocks for component styles (task-8 section 12).
				// - script-src 'unsafe-inline': Starlight's theme provider and
				//   the search modal are inline scripts. REMOVAL PATH: move
				//   ThemeSelect/theme init to an external module (requires
				//   upstream Starlight support); tracked in task-8 section 12.
				{
					tag: "meta",
					attrs: {
						"http-equiv": "Content-Security-Policy",
						content:
							"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
					},
				},
			],
			sidebar: [
				{
					label: "Start here",
					items: [
						{ label: "Overview", link: "/start/overview/" },
						{ label: "Hosted or self-hosted", link: "/start/choose/" },
						{ label: "Core concepts", link: "/start/concepts/" },
					],
				},
				{
					label: "Hosted quickstart",
					items: [
						{ label: "Quickstart", link: "/hosted/quickstart/" },
						{ label: "Authentication", link: "/hosted/authentication/" },
					],
				},
				{
					label: "Self-hosting",
					items: [
						{
							label: "Evaluation",
							items: [
								{ label: "Topology & sizing", link: "/self-hosting/overview/" },
								{ label: "Installation", link: "/self-hosting/installation/" },
								{ label: "First boot", link: "/self-hosting/first-boot/" },
							],
						},
						{
							label: "Operating",
							items: [
								{ label: "Configuration", link: "/self-hosting/configuration/" },
								{ label: "Storage", link: "/self-hosting/storage/" },
								{ label: "Reverse proxy & TLS", link: "/self-hosting/reverse-proxy/" },
								{ label: "Backup & restore", link: "/self-hosting/backup-restore/" },
								{ label: "Upgrades", link: "/self-hosting/upgrades/" },
							],
						},
						{
							label: "Reference",
							items: [
								{ label: "Troubleshooting", link: "/self-hosting/troubleshooting/" },
							],
						},
					],
				},
				{
					label: "SDKs",
					items: [
						{ label: "JavaScript (@prism/core)", link: "/sdks/javascript/" },
						{ label: "React (@prism/react)", link: "/sdks/react/" },
						{ label: "Sessions", link: "/sdks/sessions/" },
						{ label: "Events", link: "/sdks/events/" },
					],
				},
				{
					label: "Product",
					items: [
						{ label: "Projects", link: "/product/projects/" },
						{ label: "API keys", link: "/product/api-keys/" },
						{ label: "Events dashboard", link: "/product/events/" },
						{ label: "Realtime", link: "/product/realtime/" },
						{ label: "Teams", link: "/product/teams/" },
						{ label: "Account & profile", link: "/product/account/" },
					],
				},
				{
					label: "API reference",
					items: [
						{ label: "Ingestion", link: "/api-reference/ingestion/" },
						{ label: "Management", link: "/api-reference/management/" },
						{ label: "Errors & envelopes", link: "/api-reference/errors/" },
					],
				},
				{
					label: "Operations",
					items: [
						{ label: "Health checks", link: "/operations/health/" },
						{ label: "Mail", link: "/operations/mail/" },
						{ label: "Logging", link: "/operations/logging/" },
						{ label: "Networking & egress", link: "/operations/networking/" },
						{ label: "Security model", link: "/operations/security/" },
						{ label: "Privacy & data", link: "/operations/privacy/" },
					],
				},
				{
					label: "Contributing",
					items: [
						{ label: "Development setup", link: "/contributing/development/" },
						{ label: "Architecture", link: "/contributing/architecture/" },
						{ label: "Testing & quality", link: "/contributing/testing/" },
					],
				},
			],
		}),
		mdx(),
	],
	redirects: {
		"/guides/quickstart": "/hosted/quickstart",
		"/guides/self-hosting": "/self-hosting/installation",
		"/guides/backup-restore": "/self-hosting/backup-restore",
		"/reference/sdk": "/sdks/javascript",
	},
});
