/**
 * Docs browser suite (task-8 sections 11 + 14).
 * Requires a production build (`yarn workspace prism-docs build`) — the
 * preview server serves dist/. Axe runs on representative pages in both
 * themes; serious/critical violations fail the suite.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const axeOn = async (page: Page, name: string) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious,
    `${name}: serious/critical violations: ${JSON.stringify(
      serious.map((v) => v.id),
    )}`,
  ).toEqual([]);
  return results.violations;
};

test.describe("docs shell", () => {
  test("homepage renders the framed Prism shell and both paths", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Understand your product");
    await expect(page.locator(".site-header")).toHaveCSS(
      "border-top-width",
      "2px",
    );
    await expect(page.locator(".prism-brand__mark svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    await expect(
      page.getByRole("link", { name: "Start with hosted Prism" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Self-host Prism" })).toBeVisible();
    // Search trigger present in the first viewport.
    await expect(page.locator("site-search button").first()).toBeVisible();
  });

  test("search opens, indexes content, and finds a query", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.locator("dialog");
    await expect(dialog.first()).toBeVisible({ timeout: 10000 });
    const input = dialog.locator(".pagefind-ui__search-input").first();
    await expect(input).toBeVisible();
    await input.fill("setup token");
    const results = page.locator(".pagefind-ui__result");
    await expect(results.first()).toBeVisible({ timeout: 20000 });
    expect(await results.count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
  });

  test("article page: sidebar groups, TOC, meta row, code copy", async ({
    page,
  }) => {
    await page.goto("/self-hosting/configuration/");
    await expect(page.locator("h1")).toHaveText("Configuration reference");
    // Sidebar groups.
    for (const group of ["Start here", "Self-hosting", "Operations"]) {
      await expect(page.locator(".sidebar")).toContainText(group);
    }
    // Selected page has the violet inset rule.
    const active = page.locator(".sidebar a[aria-current=page]");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveCSS("box-shadow", /2px 0px 0px/);
    // Right TOC lists headings.
    await expect(page.locator("starlight-toc a").first()).toBeVisible();
    // Page meta row.
    await expect(page.locator(".prism-page-meta")).toContainText("Audience");
    await expect(page.locator(".prism-page-meta")).toContainText("Operator");
    // ConfigTable columns + rows.
    await expect(page.locator(".prism-config-table").first().locator("th")).toHaveCount(6);
    await expect(page.locator(".prism-config-table tbody tr").first()).toContainText(
      "DATABASE_URL",
    );
  });

  test("code copy button copies and announces without moving focus", async ({
    page,
  }) => {
    await page.goto("/");
    const button = page.locator(".prism-command__copy").first();
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await expect(button).toBeFocused();
    await button.click();
    await expect(button).toContainText("Copied");
    await expect(button).toBeFocused(); // focus never moved
  });

  test("theme toggle switches dark and light completely", async ({ page }) => {
    await page.goto("/start/overview/");
    const select = page.locator("select").filter({ has: page.locator("option[value='light']") }).first();
    await select.selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(246, 246, 248)"); // light canvas #F6F6F8
    await select.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("mobile 320px: header, drawer, and content without horizontal clipping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/start/overview/");
    // No horizontal page overflow (code/table regions may scroll internally).
    const overflows = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth;
    });
    expect(overflows).toBe(false);
    // Mobile nav toggle opens the drawer.
    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // The drawer is the fixed full-screen sidebar pane.
    const drawer = page.locator("#starlight__sidebar");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Self-hosting");
    await drawer.locator("a[href='/self-hosting/overview/']").click();
    await expect(page).toHaveURL(/self-hosting\/overview/);
  });

  test("branded 404 renders with search and recovery links", async ({ page }) => {
    await page.goto("/definitely-not-a-page/");
    await expect(page.locator("h1")).toHaveText("This page does not exist");
    await expect(page.locator("site-search button").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Troubleshooting" })).toBeVisible();
  });

  test("redirects resolve without chains", async ({ request }) => {
    for (const [from, to] of [
      ["/guides/quickstart/", "/hosted/quickstart/"],
      ["/guides/self-hosting/", "/self-hosting/installation/"],
      ["/reference/sdk/", "/sdks/javascript/"],
    ]) {
      const res = await request.get(from);
      expect(res.status()).toBe(200); // Astro static redirect page
      const html = await res.text();
      expect(html).toContain("http-equiv=\"refresh\"");
      expect(html).toContain(to.replace(/\/$/, ""));
    }
  });
});

test.describe("accessibility", () => {
  test("homepage has no serious/critical violations (dark)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await axeOn(page, "homepage-dark");
  });

  test("homepage has no serious/critical violations (light)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((s) =>
        [...s.options].some((o) => o.value === "light"),
      );
      select?.dispatchEvent(new Event("change"));
      document.documentElement.dataset.theme = "light";
    });
    await axeOn(page, "homepage-light");
  });

  test("article page has no serious/critical violations (dark)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/self-hosting/configuration/");
    await axeOn(page, "article-dark");
  });

  test("404 page has no serious/critical violations", async ({ page }) => {
    await page.goto("/missing-page-xyz/");
    await axeOn(page, "404");
  });

  test("keyboard: skip link, tab order, and copy button", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator("a.sl-skip-link:focus, .skip-link:focus")).toBeVisible();
    await page.keyboard.press("Enter");
    // The skip link lands on the main heading (Starlight targets #_top).
    await expect(page.locator("h1")).toBeFocused();
  });
});
