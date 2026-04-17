// Full-stack e2e: drive the UI from start screen through lobby, host start,
// role reveal, and a legislative round — all against the real handlers
// module wired to an in-memory store via Playwright's network routing.

import { test, expect } from "@playwright/test";
import { installMockSupabase } from "./fixtures/mock-supabase.ts";

test("e2e: host creates game, adds bots, starts, game transitions to nomination", async ({ page }) => {
  const { store } = await installMockSupabase(page);
  await page.goto("/");
  await page.locator("#mode-sh-btn").click();
  await page.getByRole("button", { name: /Create New Game/i }).click();
  await page.locator("#sh-player-name").fill("Hermann");
  await page.getByRole("button", { name: /Continue/i }).click();
  await expect(page.locator("#sh-lobby-screen")).toBeVisible();
  // Add bots → 5 total
  await page.getByRole("button", { name: /\+4 Test Bots/i }).click();
  await expect(page.locator("#sh-lobby-players li")).toHaveCount(5);
  // Start the game
  const startBtn = page.getByRole("button", { name: /Start Game/i });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();
  // Either role-reveal or play screen shows up
  await expect(async () => {
    const role = await page.locator("#sh-role-screen").isVisible();
    const play = await page.locator("#sh-play-screen").isVisible();
    expect(role || play).toBeTruthy();
  }).toPass({ timeout: 5000 });
  // Also assert the backend state
  const gameCode = await page.locator("#sh-lobby-code").textContent().catch(() => null);
  // shLobbyCode element is gone once we leave lobby; fetch from store instead
  const all = Array.from((store as any).rows ?? []);
  const entry = await (async () => {
    // memoryStore uses a closed-over Map — re-run via load through the last game
    // The test has already left the lobby; we fall back to reading the url
    const url = new URL(page.url());
    const code = url.searchParams.get("shjoin");
    return code ? await store.load(code) : null;
  })();
  expect(entry).not.toBeNull();
  expect(entry!.state.phase).toBe("nomination");
  expect(entry!.state.players.length).toBe(5);
});

test("e2e: URL shjoin param pre-fills join input", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/?shjoin=TESTCD");
  // Client auto-selects SH mode and pre-fills the join input
  await expect(page.locator("#mode-sh-btn")).toHaveClass(/active/);
  await expect(page.locator("#sh-join-code-input")).toHaveValue("TESTCD");
});

test("e2e: leaving a game clears the URL param", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/");
  await page.locator("#mode-sh-btn").click();
  await page.getByRole("button", { name: /Create New Game/i }).click();
  await page.locator("#sh-player-name").fill("Hermann");
  await page.getByRole("button", { name: /Continue/i }).click();
  await expect(page).toHaveURL(/shjoin=[A-Z]{4}\d{2}/);
  // Accept the leave confirm dialog
  page.on("dialog", (d) => d.accept());
  await page.locator("#leave-btn").click();
  await expect(page.locator("#start-screen")).toBeVisible();
  await expect(page).not.toHaveURL(/shjoin/);
});
