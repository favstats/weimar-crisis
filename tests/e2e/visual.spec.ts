// Visual regression: screenshot key UI states and diff against committed
// baselines. Run `npx playwright test --update-snapshots` to refresh
// baselines when design changes are intentional.

import { test, expect } from "@playwright/test";
import { installMockSupabase } from "./fixtures/mock-supabase.ts";

test.describe("visual: start screen + lobby", () => {
  test("start screen — Weimar mode default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#start-screen")).toBeVisible();
    await expect(page).toHaveScreenshot("start-weimar.png");
  });

  test("start screen — Secret Hitler mode selected", async ({ page }) => {
    await page.goto("/");
    await page.locator("#mode-sh-btn").click();
    await expect(page.locator("#sh-start-actions")).toBeVisible();
    await expect(page).toHaveScreenshot("start-sh.png");
  });

  test("start screen — SH join field pre-filled via URL", async ({ page }) => {
    await page.goto("/?shjoin=ABCD12");
    // give init() a tick to populate input
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("start-sh-urlprefill.png");
  });

  test("sh-name-screen appears after Create New Game", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.locator("#mode-sh-btn").click();
    await page.getByRole("button", { name: /Create New Game/i }).click();
    await expect(page.locator("#sh-name-screen")).toBeVisible();
    await expect(page).toHaveScreenshot("sh-name-screen.png");
  });

  test("sh-lobby-screen after host creates game", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.locator("#mode-sh-btn").click();
    await page.getByRole("button", { name: /Create New Game/i }).click();
    await page.locator("#sh-player-name").fill("Hermann");
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page.locator("#sh-lobby-screen")).toBeVisible();
    // Mask the game code (random) so the snapshot is stable
    const code = page.locator("#sh-lobby-code");
    await expect(code).toBeVisible();
    await expect(page).toHaveScreenshot("sh-lobby-host.png", {
      mask: [code, page.locator("#sh-qr-code"), page.locator(".qr-label")],
    });
  });

  test("sh-lobby with 4 bots filled", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.locator("#mode-sh-btn").click();
    await page.getByRole("button", { name: /Create New Game/i }).click();
    await page.locator("#sh-player-name").fill("Hermann");
    await page.getByRole("button", { name: /Continue/i }).click();
    await page.getByRole("button", { name: /\+4 Test Bots/i }).click();
    // Wait for bots to appear
    await expect(page.locator("#sh-lobby-players li")).toHaveCount(5);
    await expect(page).toHaveScreenshot("sh-lobby-5players.png", {
      mask: [page.locator("#sh-lobby-code"), page.locator("#sh-qr-code"), page.locator(".qr-label")],
    });
  });
});

test.describe("visual: gameplay screens", () => {
  test("role-reveal card renders (Liberal)", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.evaluate(() => {
      const sh = (window as any).__sh;
      sh.setStartMode("secrethitler");
      sh.client.priv = {
        me: {
          id: "p_1",
          name: "Hermann",
          isHost: true,
          alive: true,
          role: "liberal",
          party: "liberal",
          hasBeenInvestigated: false,
          powerRole: null,
          behaviorRole: null,
          powerUsed: false,
        },
      };
      sh.client.pub = { phase: "nomination" };
      sh.renderRole();
    });
    await expect(page.locator("#sh-role-screen")).toBeVisible();
    await expect(page).toHaveScreenshot("role-card-liberal.png");
  });

  test("role-reveal card renders (Hitler with team)", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.evaluate(() => {
      const sh = (window as any).__sh;
      sh.setStartMode("secrethitler");
      sh.client.priv = {
        me: {
          id: "p_1",
          name: "Hermann",
          isHost: true,
          alive: true,
          role: "hitler",
          party: "fascist",
          hasBeenInvestigated: false,
          powerRole: null,
          behaviorRole: null,
          powerUsed: false,
        },
        fascistTeam: [
          { id: "p_1", name: "Hermann", role: "hitler" },
          { id: "p_2", name: "Erika", role: "fascist" },
        ],
      };
      sh.client.pub = { phase: "nomination" };
      sh.renderRole();
    });
    await expect(page).toHaveScreenshot("role-card-hitler.png");
  });

  test("board renders with 2 liberal, 3 fascist enacted", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/");
    await page.evaluate(() => {
      const sh = (window as any).__sh;
      sh.setStartMode("secrethitler");
      sh.client.priv = {
        me: { id: "p_1", name: "Hermann", isHost: true, alive: true, role: "liberal", party: "liberal" },
      };
      sh.client.pub = {
        phase: "nomination",
        players: [
          { id: "p_1", name: "Hermann", isHost: true, alive: true },
          { id: "p_2", name: "Erika", isHost: false, alive: true },
          { id: "p_3", name: "Klaus", isHost: false, alive: true },
          { id: "p_4", name: "Greta", isHost: false, alive: true },
          { id: "p_5", name: "Wilhelm", isHost: false, alive: true },
        ],
        hostId: "p_1",
        presidentId: "p_1",
        chancellorId: null,
        liberalPolicies: 2,
        fascistPolicies: 3,
        electionTracker: 1,
        deckCount: 11,
        discardCount: 3,
        votesCast: [],
        winner: null,
        powerLog: [],
      };
      sh.client.roleAcknowledged = true;
      sh.renderPlay();
    });
    await expect(page.locator("#sh-play-screen")).toBeVisible();
    await expect(page).toHaveScreenshot("board-midgame.png");
  });
});
