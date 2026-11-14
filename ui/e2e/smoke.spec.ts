import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function axe(page: Page, where: string) {
  await page.waitForTimeout(450); // let the 320 ms screen fade finish, or axe reads half-transparent text
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`)).toEqual([]);
}

test("first run -> home -> mock session -> verdict, with a11y checks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mock=1&speed=200");

  // ---- first run ----
  await expect(page.getByRole("heading", { name: "Which game are you tuning?" })).toBeVisible();
  await expect(page.getByText("No telemetry.")).toBeVisible();
  await axe(page, "first run / game");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your mouse" })).toBeVisible();
  await page.getByRole("button", { name: "400", exact: true }).click();
  await page.getByRole("button", { name: "800", exact: true }).click();
  await axe(page, "first run / mouse");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your current sens" })).toBeVisible();
  await expect(page.getByTestId("first-run-cm")).toHaveText("51.95");
  await page.getByLabel("In-game sens").fill("1.2");
  await expect(page.getByTestId("first-run-cm")).toHaveText("43.30");
  await page.getByLabel("In-game sens").fill("1");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Start 5-second test" }).click();
  await expect(page.getByRole("img", { name: "Live mouse trail" })).toBeVisible();
  await axe(page, "first run / capture test");
  await expect(page.getByRole("heading", { name: "Capture works." })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish setup" }).click();

  // ---- home ----
  await expect(page.getByRole("heading", { name: "Find your sens" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Standard/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Reliable range and a best pick.")).toBeVisible();
  await axe(page, "home");
  await page.getByRole("radio", { name: /Quick/ }).click();
  await page.getByRole("button", { name: "Start session" }).click();

  // ---- session coach ----
  await expect(page.getByRole("button", { name: "Start warm-up" })).toBeVisible();
  await axe(page, "coach / warm-up");
  await page.getByRole("button", { name: "Start warm-up" }).click();
  await expect(page.getByTestId("coach-title")).toContainText("in-game", { timeout: 15_000 });
  await expect(page.getByTestId("sens-copy-chip")).toBeVisible();
  await expect(page.getByTestId("test-index")).toContainText("Test 1 of 7");
  await expect(page.getByText("Play your flick task (for example Twoshot Entry ADS or Gridshot Ultimate)")).toBeVisible();
  await axe(page, "coach / set sens");

  const start = page.getByRole("button", { name: /^Start (run|warm-up)$/ });
  let sawGotIt = false;
  await expect(async () => {
    if (await page.getByTestId("got-it").isVisible()) sawGotIt = true;
    if (await start.isVisible()) await start.click({ timeout: 1000 }).catch(() => {});
    expect(page.url()).toContain("#/verdict");
  }).toPass({ timeout: 100_000, intervals: [150] });
  expect(sawGotIt).toBe(true);

  // ---- verdict ----
  await expect(page.getByTestId("verdict-hero")).toContainText("1.21");
  await expect(page.getByTestId("verdict-hero")).toContainText("43.1");
  await expect(page.getByTestId("verdict-range")).toHaveText("38–49");
  await expect(page.getByText("v1.0 beta method").first()).toBeVisible();
  await expect(page.getByText("Confidence: OK")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate CS2 cfg" })).toBeVisible();
  expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("perfect");
  await axe(page, "verdict");

  await page.getByRole("button", { name: "Why this?" }).click();
  await expect(page.getByRole("dialog", { name: "Why this?" })).toBeVisible();
  await axe(page, "verdict / why drawer");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Generate CS2 cfg" }).click();
  await expect(page.getByText("exec sensfinder_sens")).toBeVisible();
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("keyboard: command palette opens with Ctrl+K and navigates", async ({ page }) => {
  await page.goto("/?mock=1&flags=ready");
  await expect(page.getByRole("heading", { name: "Find your sens" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("lab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Lab" })).toBeVisible();
});
