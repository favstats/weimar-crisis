// Secret Hitler — Supabase Edge Function (HTTP entry).
// All game logic lives in handlers.ts; storage in store.ts. This file is
// the thin HTTP wrapper that wires the Supabase-backed Store to the router.
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { dispatch } from "./handlers.ts";
import type { Store, StoredGame } from "./store.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
    realtime: { params: { apikey: SERVICE_ROLE } },
  });
}

// Supabase-backed Store: sh_games table + realtime broadcast on sh:CODE.
function supabaseStore(): Store {
  const sb = admin();
  return {
    async load(code: string): Promise<StoredGame | null> {
      const c = (code || "").toUpperCase().trim();
      const { data, error } = await sb.from("sh_games").select("*").eq("code", c).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        code: data.code,
        hostId: data.host_id,
        status: data.status,
        state: data.state,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
    async insert(row) {
      const { error } = await sb.from("sh_games").insert({
        code: row.code,
        host_id: row.hostId,
        status: row.status,
        state: row.state,
      });
      if (error) throw error;
    },
    async update(code, patch) {
      const payload: any = { updated_at: new Date().toISOString() };
      if (patch.state !== undefined) payload.state = patch.state;
      if (patch.status !== undefined) payload.status = patch.status;
      const { error } = await sb.from("sh_games").update(payload).eq("code", code);
      if (error) throw error;
    },
    async broadcast(code, payload) {
      try {
        const ch = sb.channel(`sh:${code}`, { config: { broadcast: { self: true, ack: false } } });
        await ch.subscribe();
        await ch.send({ type: "broadcast", event: "update", payload });
        await ch.unsubscribe();
      } catch (_) {
        // Best effort; clients have a polling fallback.
      }
    },
  };
}

const store = supabaseStore();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ success: false, error: "Bad JSON" }, 400);
  }
  try {
    const result = await dispatch(store, body?.action, body);
    return json(result);
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
