// `npm run screens`: saves a 1280x800 PNG of every screen and main state (mock mode) to docs/screens/.
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/screens");
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
async function shot(page: Page, name: string, settle = 450) {
  await page.waitForTimeout(settle);
  n += 1;
  await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`) });
}
async function open(page: Page, flags: string, route = "", speed = 1) {
  await page.goto("about:blank");
  await page.goto(`/?mock=1&flags=${flags}&speed=${speed}#/${route}`);
  await page.waitForLoadState("networkidle");
}
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
const bottom = (page: Page) => page.locator("main").evaluate((el) => el.scrollTo(0, el.scrollHeight));

test.use({ viewport: { width: 1280, height: 800 } });

test("capture every screen", async ({ page }) => {
  test.setTimeout(300_000);
  for (const f of fs.readdirSync(OUT)) if (/^\d\d-.*\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));

  // ---------- first run ----------
  await open(page, "");
  await shot(page, "first-run-game");
  await page.getByRole("radio", { name: /Marvel Rivals/ }).click();
  await shot(page, "first-run-game-rivals-locked");
  await page.getByRole("radio", { name: /CS2/ }).click();
  await btn(page, "Continue").click();
  await shot(page, "first-run-mouse");
  await btn(page, "Continue").click();
  await shot(page, "first-run-sens");
  await btn(page, "Continue").click();
  await shot(page, "first-run-capture-idle");
  await btn(page, "Start 5-second test").click();
  await shot(page, "first-run-capture-running", 2200);
  await expect(page.getByRole("heading", { name: "Capture works." })).toBeVisible({ timeout: 15_000 });
  await shot(page, "first-run-capture-done");

  // ---------- home ----------
  await open(page, "ready");
  await shot(page, "home");
  await open(page, "ready,empty,beta");
  await shot(page, "home-empty-with-beta-prompt");
  await open(page, "ready,rivals");
  await shot(page, "home-rivals-locked");
  await btn(page, "Calibrate game").click();
  await btn(page, "Start").click();
  await shot(page, "rivals-calibrate-turning");
  await btn(page, /^Stop/).click();
  await shot(page, "rivals-calibrate-result");

  // ---------- session coach (demo, real-time speed so states hold still) ----------
  await open(page, "ready");
  await page.getByRole("radio", { name: /Quick/ }).click();
  await btn(page, "Try Demo mode").click();
  await shot(page, "coach-warmup-start");
  await btn(page, "Start warm-up").click();
  await shot(page, "coach-warmup-running", 1500);
  await btn(page, "Skip warm-up").click();
  await shot(page, "coach-set-sens");
  await btn(page, "Start run").click();
  await shot(page, "coach-running", 2500);
  await btn(page, "Stop run now").click();
  await shot(page, "coach-got-it", 500);
  await expect(page.getByTestId("got-it")).toBeHidden({ timeout: 5000 });
  await shot(page, "coach-next-sens");
  await btn(page, "Pause").click();
  await shot(page, "coach-paused");
  await btn(page, "Resume session").click();
  for (let i = 0; i < 4; i++) {
    await btn(page, "Start run").click();
    await btn(page, "Stop run now").click();
    await expect(page.getByTestId("got-it")).toBeHidden({ timeout: 5000 });
  }
  await expect(btn(page, "Skip rest")).toBeVisible({ timeout: 5000 });
  await shot(page, "coach-rest", 1500);
  await btn(page, "Skip rest").click();
  await btn(page, "Start run").click();
  await btn(page, "Stop run now").click();
  await expect(page.getByTestId("got-it")).toBeHidden({ timeout: 5000 });
  await expect(page.getByText(/Pretty noisy\. One more at/)).toBeVisible();
  await shot(page, "coach-one-more-same-sens");
  await btn(page, "End session").click();
  await shot(page, "coach-end-confirm");
  await btn(page, "End and show result").click();

  // ---------- verdict ----------
  await expect(page.getByTestId("verdict-hero")).toBeVisible({ timeout: 10_000 });
  await shot(page, "verdict", 1200);
  await bottom(page);
  await shot(page, "verdict-diagnosis");
  await btn(page, "Why this?").click();
  await shot(page, "verdict-why-drawer");
  await page.keyboard.press("Escape");
  await btn(page, "Generate CS2 cfg").click();
  await shot(page, "verdict-cs2-cfg");
  await page.keyboard.press("Escape");
  await btn(page, "Save profile").click();
  await shot(page, "verdict-save-profile");
  await page.keyboard.press("Escape");
  await open(page, "ready", "verdict/2");
  await shot(page, "verdict-standard-with-shake-and-score", 1200);
  await open(page, "ready,notrend");
  await btn(page, "Start session").click();
  await btn(page, "End session").click();
  await btn(page, "End and show result").click();
  await expect(page.getByTestId("verdict-hero")).toBeVisible({ timeout: 10_000 });
  await shot(page, "verdict-no-clear-trend", 1200);

  // ---------- history / plan / lab ----------
  await open(page, "ready", "history");
  await shot(page, "history");
  const boxes = page.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(2).check();
  await btn(page, "Compare sessions").click();
  await shot(page, "history-compare", 900);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Marvel Rivals" }).click();
  await shot(page, "history-rivals-hero-tabs");
  await page.getByRole("tab", { name: "tank" }).click();
  await shot(page, "history-empty-hero-class");
  await open(page, "ready", "plan");
  await shot(page, "plan");
  await open(page, "ready", "lab");
  await shot(page, "lab", 900);
  await page.getByRole("tab", { name: "6 s" }).click();
  await page.getByLabel("Over/under threshold").fill("0.08");
  await shot(page, "lab-zoomed-threshold-changed", 900);
  await bottom(page);
  await shot(page, "lab-thresholds-and-dropped");

  // ---------- demo analyzer / screenshots / settings ----------
  await open(page, "ready", "demo");
  await shot(page, "demo-analyzer");
  await page.getByLabel("Path to a .dem file").fill("C:\\demos\\pov_workshop_01.dem");
  await btn(page, "Analyze").click();
  await shot(page, "demo-analyzer-no-usable-data");
  await bottom(page);
  await shot(page, "demo-analyzer-guide");
  await open(page, "ready,empty", "demo");
  await shot(page, "demo-analyzer-empty");
  await open(page, "ready", "shots");
  await shot(page, "screenshots-with-not-recognized-error");
  await btn(page, "Type it in").click();
  await shot(page, "screenshots-type-it-in");
  await bottom(page);
  await page.getByRole("switch", { name: "Ollama fallback" }).click();
  await bottom(page);
  await shot(page, "screenshots-watcher-and-ollama");
  await open(page, "ready", "settings");
  await shot(page, "settings");
  await btn(page, "Rebind").first().click();
  await shot(page, "settings-hotkey-rebind");
  await page.keyboard.press("Escape");
  await bottom(page);
  await shot(page, "settings-data-and-about");
  await open(page, "ready,rivals", "settings");
  await shot(page, "settings-rivals-banner");

  // ---------- palette, empty states, error banners ----------
  await open(page, "ready");
  await page.keyboard.press("Control+k");
  await shot(page, "command-palette");
  await page.keyboard.press("Escape");
  await open(page, "ready,empty", "session");
  await shot(page, "empty-session");
  await open(page, "ready,empty", "verdict");
  await shot(page, "empty-verdict");
  await open(page, "ready,empty", "plan");
  await shot(page, "empty-plan");
  await open(page, "ready,empty", "lab");
  await shot(page, "empty-lab");
  await open(page, "ready,empty", "history");
  await shot(page, "empty-history");

  await open(page, "ready,capture-paused");
  await page.getByRole("radio", { name: /Quick/ }).click();
  await btn(page, "Start session").click();
  await btn(page, "Start warm-up").click();
  await btn(page, "Skip warm-up").click();
  await btn(page, "Start run").click();
  await shot(page, "error-capture-paused", 1500);
  await open(page, "ready,low-rate");
  await shot(page, "error-low-packet-rate");
  await open(page, "ready,dpi-mismatch", "settings");
  await btn(page, "Start measuring").click();
  await btn(page, "Done").click();
  await shot(page, "error-dpi-mismatch");
  await page.goto("about:blank");
  await page.goto("/?mock=1&flags=ready,engine-down#/");
  await shot(page, "error-engine-restarting", 4500);
});
