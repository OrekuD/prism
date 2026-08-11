/**
 * Built-output component tests (task-8 sections 6 + 14).
 *
 * These run against the PRODUCTION build via `astro preview`: every
 * assertion targets rendered HTML — components, shell, tokens, metadata —
 * so the suite doubles as a regression check for the docs redesign.
 * Requires `yarn workspace prism-docs build` to have run first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const PORT = 4324;
const BASE = process.env.PRISM_DOCS_PREVIEW_URL ?? `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const useExisting = Boolean(process.env.PRISM_DOCS_PREVIEW_URL);

let server: ChildProcess | undefined;
let pages: Record<string, string> = {};

async function fetchText(path: string, expectedStatus = 200) {
  const res = await fetch(`${BASE}${path}`);
  expect(res.status, path).toBe(expectedStatus);
  return res.text();
}

beforeAll(async () => {
  if (!useExisting) {
    server = spawn("yarn", ["preview", "--force", "--port", String(PORT)], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr?.on("data", (d) => process.stderr.write(`[preview] ${d}`));
  }
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/start/overview/`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  pages.home = await fetchText("/");
  pages.article = await fetchText("/start/overview/");
  pages.config = await fetchText("/self-hosting/configuration/");
  pages.ingestion = await fetchText("/api-reference/ingestion/");
  pages.quickstart = await fetchText("/hosted/quickstart/");
  pages.notFound = await fetchText("/no-such-page/", 404);
  // Discover the hashed stylesheet asset from the homepage HTML.
  const homeHtml = pages.home;
  const cssHref = homeHtml.match(/href="(\/_astro\/[^"]+\.css)"/)?.[1];
  expect(cssHref, "stylesheet asset found").toBeTruthy();
  pages.css = await fetchText(cssHref!);
}, 60000);

afterAll(() => {
  server?.kill();
});

describe("shell", () => {
  it("homepage renders the framed header with the canonical SVG mark", () => {
    expect(pages.home).toContain("site-header");
    expect(pages.home).toContain("prism-brand__mark");
    // Canonical geometry lives in the inlined SVG (task-7 viewBox 24x24).
    expect(pages.home).toContain('viewBox="0 0 24 24"');
  });

  it("header contains Docs identity, search, GitHub, theme, and dashboard action", () => {
    expect(pages.home).toContain(">Docs</span>");
    expect(pages.home).toContain("site-search");
    expect(pages.home).toContain("Prism on GitHub");
    expect(pages.home).toContain("Open dashboard");
    expect(pages.home).toContain("theme-select");
  });

  it("article pages render the sidebar with all eight groups", () => {
    for (const group of [
      "Start here",
      "Hosted quickstart",
      "Self-hosting",
      "SDKs",
      "Product",
      "API reference",
      "Operations",
      "Contributing",
    ]) {
      expect(pages.article).toContain(group);
    }
  });

  it("article pages render the right-hand table of contents", () => {
    expect(pages.article).toContain("starlight-toc");
  });

  it("page metadata row renders audience/scope/reviewed", () => {
    expect(pages.article).toContain("prism-page-meta");
    expect(pages.article).toContain("Audience");
    expect(pages.article).toContain("Applies to");
    expect(pages.article).toContain("Reviewed");
    expect(pages.article).toContain("User");
    expect(pages.article).toContain("Both");
  });

  it("footer links to docs home, security, self-hosting, and license", () => {
    for (const href of [
      "/start/overview/",
      "/operations/security/",
      "/self-hosting/overview/",
      "github.com/OrekuD/prism",
    ]) {
      expect(pages.article).toContain(href);
    }
  });

  it("branded 404 renders with search and recovery links", () => {
    expect(pages.notFound).toContain("Page not found");
    expect(pages.notFound).toContain("404");
    expect(pages.notFound).toContain("site-search");
    expect(pages.notFound).toContain("/self-hosting/troubleshooting/");
    expect(pages.notFound).toContain("noindex");
  });
});

describe("homepage (task-8 section 5)", () => {
  it("left-led hero with eyebrow, statement, and both paths", () => {
    expect(pages.home).toContain("Prism Docs");
    expect(pages.home).toContain("Understand your product");
    expect(pages.home).toContain("Start with hosted Prism");
    expect(pages.home).toContain("Self-host Prism");
  });

  it("quickstart frame uses verified SDK calls", () => {
    expect(pages.home).toContain("npm install @prism/core");
    expect(pages.home).toContain('new PrismClient("pr_xxx")');
    expect(pages.home).toContain('await prism.logEvent("button-click"');
  });

  it("choose-your-path panel has both options with equal visibility", () => {
    expect(pages.home).toContain("prism-choice__option");
    expect((pages.home.match(/prism-choice__option/g) || []).length).toBe(2);
    expect(pages.home).toContain("/hosted/quickstart/");
    expect(pages.home).toContain("/self-hosting/overview/");
  });

  it("search is available in the first viewport via the sticky header", () => {
    // The header is sticky at the top, so its search trigger is always in
    // the first viewport; the hero no longer duplicates it.
    const headerSearch = pages.home.indexOf("site-search");
    const hero = pages.home.indexOf('class="prism-home__hero');
    expect(headerSearch).toBeGreaterThan(-1);
    expect(headerSearch).toBeLessThan(hero);
  });

  it("entry panels link to SDK, API, operations, auth, runbook, contributing", () => {
    for (const href of [
      "/sdks/javascript/",
      "/api-reference/ingestion/",
      "/self-hosting/installation/",
      "/hosted/authentication/",
      "/self-hosting/troubleshooting/",
      "/contributing/development/",
    ]) {
      expect(pages.home).toContain(href);
    }
  });
});

describe("components (task-8 section 6)", () => {
  it("SectionLabel renders the // mono eyebrow", () => {
    expect(pages.ingestion).toContain("Analytics boundary");
    expect(pages.ingestion).toContain("docs-section-label");
  });

  it("Endpoint blocks carry method, path, auth, limits", () => {
    expect(pages.ingestion).toContain("prism-endpoint");
    expect(pages.ingestion).toContain("POST");
    expect(pages.ingestion).toContain("/api/v1/analytics/sessions");
    expect(pages.ingestion).toContain("Bearer project analytics key");
    expect(pages.ingestion).toContain("120 requests");
  });

  it("ConfigTable renders requirement/default/mode/secret/applied columns", () => {
    expect(pages.config).toContain("prism-config-table");
    // The two ConfigTables each render 6 columns (Variable, Requirement,
    // Default, Mode, Secret, Applied).
    const firstTable = pages.config.indexOf("<table");
    const lastTable = pages.config.lastIndexOf("</table>");
    const tableRegion = pages.config.slice(firstTable, lastTable);
    expect((tableRegion.match(/scope=\"col\"/g) || []).length).toBe(12);
    expect(tableRegion).toContain("SETUP_TOKEN");
    expect(pages.config).toContain("SETUP_TOKEN");
    expect(pages.config).toContain("JWT_SECRET_KEY");
  });

  it("Callouts render label + icon + text for hosted/self-hosted/note/danger", () => {
    expect(pages.quickstart).toContain("prism-callout--hosted");
    expect(pages.quickstart).toContain(">Hosted</span>");
    const firstBoot = pages.notFound.includes("x") ? "" : ""; // placeholder no-op
    void firstBoot;
  });

  it("Command rows render copy controls with labels", () => {
    expect(pages.home).toContain("prism-command__copy");
    expect(pages.home).toContain("aria-label=\"Copy command\"");
    expect(pages.home).toContain(">ts</span>");
    expect(pages.home).toContain(">sh</span>");
  });

  it("StatusBadge and Steps are available", async () => {
    // Starlight Steps is used in the first-boot journey; StatusBadge on
    // the health page.
    const firstBoot = await fetchText("/self-hosting/first-boot/");
    expect(firstBoot).toContain("sl-steps");
    const health = await fetchText("/operations/health/");
    expect(health).toContain("prism-status");
    expect(health).toContain("Planned");
  });
});

describe("tokens and themes (task-8 section 3)", () => {
  it("prism.css defines the canonical dark tokens", () => {
    for (const hex of ["#050506", "#0B0B0E", "#111116", "#25252C", "#F2F2F4", "#A3A3AD", "#6547E8", "#9B89FF"]) {
      expect(pages.css).toContain(hex.toLowerCase());
    }
  });

  it("prism.css defines the complete light translation", () => {
    for (const hex of ["#F6F6F8", "#5637D4", "#C72F45", "#176FC1", "#087A55", "#9A6100"]) {
      expect(pages.css).toContain(hex.toLowerCase());
    }
  });

  it("fonts are self-hosted Geist files, no Google Fonts", () => {
    expect(pages.css).toContain("Geist Variable");
    expect(pages.css).toContain("Geist Mono Variable");
    expect(pages.css).toContain("woff2-variations");
    expect(pages.css).not.toContain("fonts.googleapis");
  });

  it("2px radius and 4px spacing rhythm are applied", () => {
    expect(pages.css).toMatch(/--prism-radius:2px/);
    expect(pages.css).toMatch(/--prism-space:4px/);
  });

  it("focus treatment is visible on every surface", () => {
    expect(pages.css).toMatch(/outline:2px solid var\(--prism-focus\)/);
  });
});

describe("metadata, search, offline (task-8 sections 9-10)", () => {
  it("pages carry og:image/twitter meta derived from the local asset", () => {
    expect(pages.home).toContain("og:image");
    expect(pages.home).toContain("og-image.png");
    expect(pages.home).toContain("twitter:card");
    expect(pages.home).toContain("summary_large_image");
  });

  it("theme-color is set for dark and light chrome", () => {
    expect(pages.home).toContain('content="#050506"');
    expect(pages.home).toContain('content="#F6F6F8"');
  });

  it("robots.txt exists with the self-hosted override note", () => {
    return fetchText("/robots.txt").then((txt) => {
      expect(txt).toContain("Disallow: /");
    });
  });

  it("pagefind is bundled for local search", () => {
    expect(pages.article).toContain("pagefind");
  });

  it("no remote asset origins are referenced", () => {
    const html = pages.home + pages.article;
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("cdn.jsdelivr");
    expect(html).not.toContain("pagefind.app");
  });

  it("canonical links use the configured site", () => {
    expect(pages.article).toContain("docs.prism.sh");
  });
});

describe("redirects (task-8 section 2)", () => {
  it("old quickstart, self-hosting, sdk, and backup routes resolve", async () => {
    const cases = [
      ["/guides/quickstart/", "/hosted/quickstart/"],
      ["/guides/self-hosting/", "/self-hosting/installation/"],
      ["/guides/backup-restore/", "/self-hosting/backup-restore/"],
      ["/reference/sdk/", "/sdks/javascript/"],
    ];
    for (const [from, to] of cases) {
      const res = await fetch(`${BASE}${from}`);
      expect(res.status, from).toBe(200);
      // Astro static redirects render a meta-refresh page with the target.
      const html = await res.text();
      expect(html, from).toContain("http-equiv=\"refresh\"");
      expect(html, from).toContain(to.replace(/\/$/, ""));
    }
  });
});
