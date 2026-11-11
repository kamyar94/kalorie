// Shared parts of the Move and Body end-to-end specs (the same checks as screens.spec.ts): a
// database pool, an account through an invite, browser errors that fail a test, no sideways
// scroll, and axe WCAG 2.1 AA once animations have finished.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { shiftLocalDate } from "../../lib/meals/time";
import { runCommand } from "../../scripts/cal.mjs";

export const PASSWORD = "e2e password that is long";

let poolRef: pg.Pool | null = null;
export const pool = () => poolRef!;

/** Installs the hooks: the pool, and browser errors failing the test (unless expected). */
export const installE2eHooks = () => {
  const errors: string[] = [];
  const allowed: { current: RegExp | null } = { current: null };
  test.beforeAll(() => {
    poolRef = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 });
  });
  test.afterAll(async () => {
    await poolRef?.end();
    poolRef = null;
  });
  test.beforeEach(({ page }) => {
    errors.length = 0;
    allowed.current = null;
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
  });
  test.afterEach(() => {
    expect(errors.filter((e) => !allowed.current?.test(e))).toEqual([]);
  });
  return allowed;
};

export const expectNoSidewaysScroll = async (page: Page) => {
  const sizes = await page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.querySelector('nav[aria-label="Main"]');
    return {
      overflow: root.scrollWidth - root.clientWidth,
      navOverflow: nav ? nav.getBoundingClientRect().width - root.clientWidth : 0,
    };
  });
  expect(sizes.overflow, "page wider than the screen").toBeLessThanOrEqual(0);
  expect(sizes.navOverflow, "navigation wider than the screen").toBeLessThanOrEqual(0);
};

export const expectAccessible = async (page: Page) => {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  );
  await expectNoSidewaysScroll(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.flatMap((v) =>
      v.nodes.map(
        (n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary?.replace(/\s+/g, " ")}`,
      ),
    ),
  ).toEqual([]);
};

let counter = 0;
/** A new account through an invite; returns its id. */
export const signUp = async (page: Page, project: string, admin = false) => {
  const args = ["invite", "--note", "e2e", ...(admin ? ["--admin"] : [])];
  const { code } = await runCommand(pool(), args, () => undefined);
  const username = `m_${project.replace(/\W/g, "")}_${Date.now().toString(36)}${counter++}`;
  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
  const row = await pool().query("select id from users where username = $1", [username]);
  return row.rows[0].id as string;
};

/** The browser's own time zone (it runs on this machine) and its calendar day n days away. */
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const localDay = (offset = 0) =>
  shiftLocalDate(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    offset,
  );
