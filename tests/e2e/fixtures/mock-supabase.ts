// Intercept Supabase Edge Function calls at the Playwright layer and route
// them through the real handlers module (backed by an in-memory Store) so
// e2e tests exercise the full UI against deterministic backend behavior.

import type { Page, Route } from "@playwright/test";
import { dispatch } from "../../../supabase/functions/sh/handlers.ts";
import { memoryStore } from "../../../supabase/functions/sh/store.ts";

export interface MockContext {
  store: ReturnType<typeof memoryStore>;
}

export async function installMockSupabase(page: Page): Promise<MockContext> {
  const store = memoryStore();

  await page.route(/.*\.supabase\.co\/functions\/v1\/sh$/, async (route: Route) => {
    const body = route.request().postDataJSON() ?? {};
    const result = await dispatch(store, body.action, body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(result),
    });
  });

  // Reject any supabase-realtime websocket attempt — client falls back to
  // its built-in polling which we also intercept above.
  await page.route(/wss?:\/\/.*supabase\.co\/.*/, (route) => route.abort());

  return { store };
}
