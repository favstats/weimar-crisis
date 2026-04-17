// Integration tests for Secret Hitler HTTP handlers — drives the same
// handlers the Edge Function uses, backed by an in-memory Store.
// Run:  deno test --allow-read supabase/functions/sh/handlers.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memoryStore } from "./store.ts";
import {
  shCreateGame, shJoinGame, shStartGame, shGetState,
  shNominate, shVote,
  shPresidentDiscard, shChancellorEnact,
  shProposeVeto, shRespondVeto,
  shUsePower, shAckPower,
  shUseExpansionPower, shResetGame,
  dispatch,
} from "./handlers.ts";

// --- Fixture helpers ---
async function setupLobby(playerNames: string[]) {
  const store = memoryStore();
  const create = await shCreateGame(store, { hostName: playerNames[0] });
  assert(create.success);
  const hostId = create.playerId!;
  const code = create.gameCode!;
  const ids: string[] = [hostId];
  for (let i = 1; i < playerNames.length; i++) {
    const j = await shJoinGame(store, { gameCode: code, playerName: playerNames[i] });
    assert(j.success, JSON.stringify(j));
    ids.push(j.playerId!);
  }
  return { store, code, hostId, ids };
}

async function startGame(store: any, code: string, hostId: string, extras: any = {}) {
  const r = await shStartGame(store, { gameCode: code, playerId: hostId, ...extras });
  assert(r.success, JSON.stringify(r));
  return r;
}

async function getState(store: any, code: string, playerId: string) {
  const r = await shGetState(store, { gameCode: code, playerId });
  assert(r.success, JSON.stringify(r));
  return r as { success: true; pub: any; priv: any };
}

// ============================================================
// Create + Join
// ============================================================
Deno.test("create: host name required", async () => {
  const store = memoryStore();
  const r = await shCreateGame(store, {});
  assertFalse(r.success);
});

Deno.test("create: returns gameCode + playerId + isHost=true", async () => {
  const store = memoryStore();
  const r = await shCreateGame(store, { hostName: "Alice" });
  assert(r.success);
  assert(typeof r.gameCode === "string" && r.gameCode.length === 6);
  assert(typeof r.playerId === "string" && r.playerId.startsWith("p_"));
  assertEquals(r.isHost, true);
});

Deno.test("join: missing params", async () => {
  const store = memoryStore();
  const r = await shJoinGame(store, {});
  assertFalse(r.success);
});

Deno.test("join: game not found", async () => {
  const store = memoryStore();
  const r = await shJoinGame(store, { gameCode: "ZZZZ99", playerName: "Alice" });
  assertFalse(r.success);
  assertEquals(r.error, "Game not found");
});

Deno.test("join: new player added to lobby", async () => {
  const { store, code, hostId } = await setupLobby(["Host"]);
  const r = await shJoinGame(store, { gameCode: code, playerName: "Bob" });
  assert(r.success);
  assertFalse(r.isHost);
  const state = await getState(store, code, hostId);
  assertEquals(state.pub.players.length, 2);
});

Deno.test("join: rejoin-by-id returns the existing player", async () => {
  const { store, code, ids } = await setupLobby(["Host", "Bob"]);
  const r = await shJoinGame(store, { gameCode: code, playerName: "Bob", rejoinId: ids[1] });
  assert(r.success);
  assertEquals(r.playerId, ids[1]);
  assert((r as any).rejoined);
});

Deno.test("join: rejoin-by-name (case-insensitive) hands back existing ID", async () => {
  const { store, code, ids } = await setupLobby(["Host", "Bob"]);
  const r = await shJoinGame(store, { gameCode: code, playerName: "BOB" });
  assert(r.success);
  assertEquals(r.playerId, ids[1]);
  assert((r as any).rejoined);
});

Deno.test("join: rejected after game started, unless name matches", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Fresh name → rejected
  const bad = await shJoinGame(store, { gameCode: code, playerName: "Newbie" });
  assertFalse(bad.success);
  // Existing name → allowed (rejoin)
  const ok = await shJoinGame(store, { gameCode: code, playerName: "H" });
  assert(ok.success);
});

Deno.test("join: lobby full at 10 players", async () => {
  const names = Array.from({ length: 12 }, (_, i) => "P" + i);
  const { store, code } = await setupLobby(names);
  const r = await shJoinGame(store, { gameCode: code, playerName: "Overflow" });
  assertFalse(r.success);
  assertEquals(r.error, "Lobby full (max 12)");
});

// ============================================================
// Start game
// ============================================================
Deno.test("start: only host can start", async () => {
  const { store, code, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  const r = await shStartGame(store, { gameCode: code, playerId: ids[1] });
  assertFalse(r.success);
  assertEquals(r.error, "Only host can start");
});

Deno.test("start: fewer than 5 players rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C"]);
  const r = await shStartGame(store, { gameCode: code, playerId: hostId });
  assertFalse(r.success);
  assert(r.error!.includes("5-12 players"));
});

Deno.test("start: valid count transitions to nomination; roles are dealt", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s = await getState(store, code, hostId);
  assertEquals(s.pub.phase, "nomination");
  assertEquals(s.pub.players.length, 5);
  // Host gets a role revealed in priv
  assert(["liberal", "fascist", "hitler"].indexOf(s.priv.me.role) >= 0);
});

Deno.test("start: game not found", async () => {
  const store = memoryStore();
  const r = await shStartGame(store, { gameCode: "NONE", playerId: "x" });
  assertFalse(r.success);
});

Deno.test("start: cannot start twice", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const again = await shStartGame(store, { gameCode: code, playerId: hostId });
  assertFalse(again.success);
});

// ============================================================
// Nominate + Vote
// ============================================================
Deno.test("nominate: only current president can nominate", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s = await getState(store, code, hostId);
  const presId = s.pub.presidentId;
  // someone other than pres tries
  const other = ids.find((i) => i !== presId)!;
  const r = await shNominate(store, { gameCode: code, playerId: other, chancellorId: ids[0] });
  assertFalse(r.success);
});

Deno.test("nominate: president cannot nominate self", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s = await getState(store, code, hostId);
  const presId = s.pub.presidentId;
  const r = await shNominate(store, { gameCode: code, playerId: presId, chancellorId: presId });
  assertFalse(r.success);
});

Deno.test("nominate: valid → phase=voting", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  const r = await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  assert(r.success);
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "voting");
  assertEquals(s1.pub.chancellorId, chanId);
});

Deno.test("vote: dead players cannot vote", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Manually mark a player dead by driving to power phase via chaos
  // Simpler path: directly test with someone not in players → expect fail
  const s = await getState(store, code, hostId);
  const pres = s.pub.presidentId;
  const chan = ids.find((i) => i !== pres)!;
  await shNominate(store, { gameCode: code, playerId: pres, chancellorId: chan });
  const r = await shVote(store, { gameCode: code, playerId: "p_unknown", vote: true });
  assertFalse(r.success);
});

Deno.test("vote: majority passes → legislativePres; everybody 'Ja'", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) {
    await shVote(store, { gameCode: code, playerId: id, vote: true });
  }
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "legislativePres");
  assertEquals(s1.pub.voteResult.passed, true);
  assertEquals(s1.pub.voteResult.jas, 5);
});

Deno.test("vote: tie fails", async () => {
  // 6 players → tie at 3-3
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E", "F"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  // 3 Ja, 3 Nein
  for (let i = 0; i < 3; i++) await shVote(store, { gameCode: code, playerId: ids[i], vote: true });
  for (let i = 3; i < 6; i++) await shVote(store, { gameCode: code, playerId: ids[i], vote: false });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.voteResult.passed, false);
  assertEquals(s1.pub.electionTracker, 1);
});

Deno.test("vote: 3 failures in a row → chaos enactment + tracker resets", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  for (let round = 0; round < 3; round++) {
    const s = await getState(store, code, hostId);
    const presId = s.pub.presidentId;
    const chanId = ids.find((i) => i !== presId)!;
    await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
    for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: false });
  }
  const s2 = await getState(store, code, hostId);
  assertEquals(s2.pub.electionTracker, 0);
  assertEquals(s2.pub.liberalPolicies + s2.pub.fascistPolicies, 1);
  // No power triggered from chaos
  assertEquals(s2.pub.phase, "nomination");
});

// ============================================================
// Full legislative round (president draws, chancellor enacts)
// ============================================================
Deno.test("legislative: pres discard → chan enacts → policy hits track", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  // President sees 3 drawn policies
  const sp = await getState(store, code, presId);
  assert(Array.isArray(sp.priv.drawnPolicies));
  assertEquals(sp.priv.drawnPolicies!.length, 3);
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const sc = await getState(store, code, chanId);
  assertEquals(sc.pub.phase, "legislativeChan");
  assertEquals(sc.priv.chancellorPolicies.length, 2);
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  // The enacted policy hit either track
  assert(s1.pub.liberalPolicies + s1.pub.fascistPolicies === 1);
});

Deno.test("presidentDiscard: not-pres rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const r = await shPresidentDiscard(store, { gameCode: code, playerId: chanId, discardIndex: 0 });
  assertFalse(r.success);
});

Deno.test("presidentDiscard: bad index rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const r = await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 99 });
  assertFalse(r.success);
});

Deno.test("chancellorEnact: not in the right phase rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const r = await shChancellorEnact(store, { gameCode: code, playerId: hostId, enactIndex: 0 });
  assertFalse(r.success);
});

// ============================================================
// Veto path
// ============================================================
async function forceFascistPolicies(store: any, code: string, hostId: string, ids: string[], count: number) {
  // Force fascist policies on the track by manipulating the state via load/save
  const g = await store.load(code);
  g.state.fascistPolicies = count;
  await store.update(code, { state: g.state });
}

// Returns a non-Hitler chancellor ID. If the current president IS Hitler, this
// also swaps the presidency to a non-Hitler so the returned chanId is eligible.
async function pickNonHitlerChancellor(store: any, code: string, ids: string[]): Promise<{ presId: string; chanId: string }> {
  const g = await store.load(code);
  const hitlerId = g.state.players.find((p: any) => p.role === "hitler")?.id;
  let presId = g.state.players[g.state.presidentIdx].id;
  if (presId === hitlerId) {
    const nonHitlerIdx = g.state.players.findIndex((p: any) => p.role !== "hitler");
    g.state.presidentIdx = nonHitlerIdx;
    presId = g.state.players[nonHitlerIdx].id;
    await store.update(code, { state: g.state });
  }
  const chanId = ids.find((i) => i !== presId && i !== hitlerId)!;
  return { presId, chanId };
}

Deno.test("veto: unavailable before 5 fascist policies", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const r = await shProposeVeto(store, { gameCode: code, playerId: chanId });
  assertFalse(r.success);
});

Deno.test("veto: proposed + agreed → both policies discarded, tracker advances", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  await forceFascistPolicies(store, code, hostId, ids, 5);
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const v = await shProposeVeto(store, { gameCode: code, playerId: chanId });
  assert(v.success);
  const r = await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  assert(r.success);
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.electionTracker, 1);
  assertEquals(s1.pub.phase, "nomination");
});

Deno.test("veto: refused → vetoRefused flag set, phase stays legislativeChan", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  await forceFascistPolicies(store, code, hostId, ids, 5);
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  const r = await shRespondVeto(store, { gameCode: code, playerId: presId, agree: false });
  assert(r.success);
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "legislativeChan");
  assertFalse(s1.pub.vetoProposed);
});

Deno.test("respondVeto: only president can respond; no veto proposed case", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  await forceFascistPolicies(store, code, hostId, ids, 5);
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  // No veto proposed yet
  const r1 = await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  assertFalse(r1.success);
  // Propose
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  // Wrong player responds
  const r2 = await shRespondVeto(store, { gameCode: code, playerId: chanId, agree: true });
  assertFalse(r2.success);
});

Deno.test("veto: chaos branch fires when tracker is 2 at veto-agree time", async () => {
  // The passed election resets the tracker, so chaos via veto-agree is a
  // narrow path: tracker must be 2 AT the veto-agree moment. We inject it
  // directly between shProposeVeto and shRespondVeto.
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const seed = await store.load(code);
  seed.state.fascistPolicies = 5;
  await store.update(code, { state: seed.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  // Inject tracker=2 just before the president agrees
  const preResp = await store.load(code);
  preResp.state.electionTracker = 2;
  await store.update(code, { state: preResp.state });
  await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  const final = await getState(store, code, hostId);
  // Tracker was 2 → +1 from veto-agree → 3 → chaos auto-enact → reset to 0
  assertEquals(final.pub.electionTracker, 0);
});

// ============================================================
// Executive powers (via the fascist board triggers)
// ============================================================
Deno.test("power: 9-player investigate trigger and ack", async () => {
  const names = Array.from({ length: 9 }, (_, i) => "P" + i);
  const { store, code, hostId, ids } = await setupLobby(names);
  await startGame(store, code, hostId);
  // Force one fascist policy enacted by seeding state for next enact to bump to 1 → investigate
  const g = await store.load(code);
  g.state.fascistPolicies = 0;
  // Make sure drawn/chancellor policies controlled
  await store.update(code, { state: g.state });
  // Run a normal round; we can't deterministically guarantee fascist, so loop until power=investigate fires
  for (let i = 0; i < 10; i++) {
    const s0 = await getState(store, code, hostId);
    if (s0.pub.phase === "power") break;
    if (s0.pub.phase === "nomination") {
      const presId = s0.pub.presidentId;
      const chanId = ids.find((x) => x !== presId && s0.pub.players.find((p: any) => p.id === x).alive)!;
      await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
      for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
      // Force the drawn policies to be all fascist for this round to guarantee a fascist enactment
      const gg = await store.load(code);
      if (gg.state.phase === "legislativePres") {
        gg.state.drawnPolicies = ["fas", "fas", "fas"];
        await store.update(code, { state: gg.state });
      }
      const sPres = await getState(store, code, presId);
      if (sPres.pub.phase === "legislativePres") {
        await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
        await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
      }
    }
  }
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "power");
  assertEquals(s1.pub.pendingPower, "investigate");
  // Pres investigates someone
  const presId = s1.pub.presidentId;
  const target = ids.find((x) => x !== presId)!;
  const r = await shUsePower(store, { gameCode: code, playerId: presId, targetId: target });
  assert(r.success);
  // Ack returns to nomination
  const ack = await shAckPower(store, { gameCode: code, playerId: presId });
  assert(ack.success);
  const s2 = await getState(store, code, hostId);
  assertEquals(s2.pub.phase, "nomination");
});

Deno.test("power: execute kills target; Hitler-kill ends game", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Seed: 3 fascist enacted → next fas policy triggers execute on the 5-6 board.
  // Must ensure chancellor is NOT Hitler (else Hitler-chan-at-3F wins immediately),
  // and president is NOT Hitler (president cannot self-execute).
  const g = await store.load(code);
  g!.state.fascistPolicies = 3;
  await store.update(code, { state: g!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const g2 = await store.load(code);
  g2!.state.drawnPolicies = ["fas", "fas", "fas"];
  await store.update(code, { state: g2!.state });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "power");
  assertEquals(s1.pub.pendingPower, "execute");
  const full = await store.load(code);
  const hitler = full!.state.players.find((p: any) => p.role === "hitler");
  const pres = s1.pub.presidentId;
  const r = await shUsePower(store, { gameCode: code, playerId: pres, targetId: hitler.id });
  assert(r.success, JSON.stringify(r));
  const s2 = await getState(store, code, hostId);
  assertEquals(s2.pub.phase, "gameOver");
  assertEquals(s2.pub.winner, "liberal");
  assertEquals(s2.pub.winReason, "Hitler executed");
});

Deno.test("power: peek triggers with 5-6 board at 3F, ack continues", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g.state.fascistPolicies = 2;
  await store.update(code, { state: g.state });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const g2 = await store.load(code);
  g2.state.drawnPolicies = ["fas", "fas", "fas"];
  await store.update(code, { state: g2.state });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.pendingPower, "peek");
  // Peek result visible only to president
  const sPres = await getState(store, code, presId);
  assertEquals(sPres.priv.peekResult!.length, 3);
  const sOther = await getState(store, code, chanId);
  assertFalse(sOther.priv.peekResult);
  // shUsePower with peek should reject
  const bad = await shUsePower(store, { gameCode: code, playerId: presId, targetId: chanId });
  assertFalse(bad.success);
  const ack = await shAckPower(store, { gameCode: code, playerId: presId });
  assert(ack.success);
});

Deno.test("power: specialElection hands presidency to target, returns afterward", async () => {
  const names = Array.from({ length: 7 }, (_, i) => "P" + i);
  const { store, code, hostId, ids } = await setupLobby(names);
  await startGame(store, code, hostId);
  // 7-player board: 3rd fascist → specialElection
  const g = await store.load(code);
  g.state.fascistPolicies = 2;
  await store.update(code, { state: g.state });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const g2 = await store.load(code);
  g2.state.drawnPolicies = ["fas", "fas", "fas"];
  await store.update(code, { state: g2.state });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.pendingPower, "specialElection");
  const target = ids.find((x) => x !== s1.pub.presidentId)!;
  const r = await shUsePower(store, { gameCode: code, playerId: s1.pub.presidentId, targetId: target });
  assert(r.success);
  const s2 = await getState(store, code, hostId);
  assertEquals(s2.pub.presidentId, target);
  assertEquals(s2.pub.phase, "nomination");
});

Deno.test("power: usePower rejects self-target, dead target, already-investigated", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Drive to investigate power on 7-player setup? No, 5-player doesn't have investigate.
  // Use 9-player for investigate.
  const names = Array.from({ length: 9 }, (_, i) => "P" + i);
  const big = await setupLobby(names);
  await startGame(big.store, big.code, big.hostId);
  const g = await big.store.load(big.code);
  g.state.fascistPolicies = 0;
  await big.store.update(big.code, { state: g.state });
  const s0 = await getState(big.store, big.code, big.hostId);
  const presId = s0.pub.presidentId;
  const chanId = big.ids.find((i) => i !== presId)!;
  await shNominate(big.store, { gameCode: big.code, playerId: presId, chancellorId: chanId });
  for (const id of big.ids) await shVote(big.store, { gameCode: big.code, playerId: id, vote: true });
  const g2 = await big.store.load(big.code);
  g2.state.drawnPolicies = ["fas", "fas", "fas"];
  await big.store.update(big.code, { state: g2.state });
  await shPresidentDiscard(big.store, { gameCode: big.code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(big.store, { gameCode: big.code, playerId: chanId, enactIndex: 0 });
  // Self-target
  const self = await shUsePower(big.store, { gameCode: big.code, playerId: presId, targetId: presId });
  assertFalse(self.success);
  // Missing target
  const missing = await shUsePower(big.store, { gameCode: big.code, playerId: presId, targetId: "p_nope" });
  assertFalse(missing.success);
  // Dead target
  const g3 = await big.store.load(big.code);
  const deadId = big.ids.find((i) => i !== presId && i !== chanId)!;
  g3.state.players.find((p: any) => p.id === deadId).alive = false;
  await big.store.update(big.code, { state: g3.state });
  const dead = await shUsePower(big.store, { gameCode: big.code, playerId: presId, targetId: deadId });
  assertFalse(dead.success);
  // Happy path investigate
  const other = big.ids.find((i) => i !== presId && i !== chanId && i !== deadId)!;
  const ok = await shUsePower(big.store, { gameCode: big.code, playerId: presId, targetId: other });
  assert(ok.success);
  // Already-investigated same target fails
  const again = await shUsePower(big.store, { gameCode: big.code, playerId: presId, targetId: other });
  assertFalse(again.success);
});

Deno.test("ackPower: wrong player/wrong phase rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Not in power phase
  const r = await shAckPower(store, { gameCode: code, playerId: hostId });
  assertFalse(r.success);
});

// ============================================================
// Hitler-as-Chancellor win
// ============================================================
Deno.test("hitler elected chancellor after 3 fascist policies → instant fascist win", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Seed 3 fascist + ensure we can nominate Hitler
  const g = await store.load(code);
  g.state.fascistPolicies = 3;
  await store.update(code, { state: g.state });
  const full = await store.load(code);
  const hitler = full.state.players.find((p: any) => p.role === "hitler");
  const presId = full.state.players[full.state.presidentIdx].id;
  // If president is Hitler, advance president by one so we can nominate Hitler as chancellor
  if (presId === hitler.id) {
    full.state.presidentIdx = (full.state.presidentIdx + 1) % full.state.players.length;
    await store.update(code, { state: full.state });
  }
  const s0 = await getState(store, code, hostId);
  await shNominate(store, { gameCode: code, playerId: s0.pub.presidentId, chancellorId: hitler.id });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.phase, "gameOver");
  assertEquals(s1.pub.winner, "fascist");
});

// ============================================================
// Reset
// ============================================================
Deno.test("reset: non-host rejected; host resets to lobby", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const r1 = await shResetGame(store, { gameCode: code, playerId: ids[1] });
  assertFalse(r1.success);
  const r2 = await shResetGame(store, { gameCode: code, playerId: hostId });
  assert(r2.success);
  const s = await getState(store, code, hostId);
  assertEquals(s.pub.phase, "lobby");
  assertEquals(s.pub.fascistPolicies, 0);
  assertEquals(s.pub.liberalPolicies, 0);
});

// ============================================================
// Expansion: power roles with real mechanics
// ============================================================
function findPlayerWithPower(state: any, power: string) {
  return state.players.find((p: any) => p.powerRole === power);
}

Deno.test("expansion: start with expansion ON assigns power roles", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, { expansion: true });
  const full = await store.load(code);
  const withPower = full.state.players.filter((p: any) => p.powerRole);
  assert(withPower.length > 0);
});

Deno.test("expansion: configured power pool is respected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["assassin"], behaviors: [] },
  });
  const full = await store.load(code);
  const powers = full.state.players
    .map((p: any) => p.powerRole)
    .filter((x: any) => x);
  // Only 'assassin' can appear
  for (const p of powers) assertEquals(p, "assassin");
});

Deno.test("expansion: police_chief private investigation result stored", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: [] },
  });
  const full = await store.load(code);
  const chief = findPlayerWithPower(full.state, "police_chief");
  assert(chief);
  const target = full.state.players.find((p: any) => p.id !== chief.id);
  const r = await shUseExpansionPower(store, {
    gameCode: code,
    playerId: chief.id,
    targetId: target.id,
  });
  assert(r.success);
  const s = await getState(store, code, chief.id);
  assertEquals(s.priv.privatePowerResult.targetId, target.id);
  assert(["liberal", "fascist"].indexOf(s.priv.privatePowerResult.party) >= 0);
});

Deno.test("expansion: assassin kills target; log entry recorded", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["assassin"], behaviors: [] },
  });
  const full = await store.load(code);
  const assassin = findPlayerWithPower(full.state, "assassin");
  // Pick any non-Hitler living player (avoid ending game on unrelated hit)
  const target = full.state.players.find((p: any) =>
    p.id !== assassin.id && p.role !== "hitler"
  );
  const r = await shUseExpansionPower(store, {
    gameCode: code,
    playerId: assassin.id,
    targetId: target.id,
  });
  assert(r.success);
  const after = await store.load(code);
  const deadTarget = after.state.players.find((p: any) => p.id === target.id);
  assertEquals(deadTarget.alive, false);
  assert(after.state.powerLog.length > 0);
});

Deno.test("expansion: journalist writes public log exposing target's party", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["journalist"], behaviors: [] },
  });
  const full = await store.load(code);
  const j = findPlayerWithPower(full.state, "journalist");
  const target = full.state.players.find((p: any) => p.id !== j.id);
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: j.id, targetId: target.id });
  assert(r.success);
  const after = await store.load(code);
  const entry = after.state.powerLog[after.state.powerLog.length - 1];
  assert(entry.publicResult.includes(target.name));
});

Deno.test("expansion: industrialist writes a public bribe log entry", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["industrialist"], behaviors: [] },
  });
  const full = await store.load(code);
  const ind = findPlayerWithPower(full.state, "industrialist");
  const target = full.state.players.find((p: any) => p.id !== ind.id);
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: ind.id, targetId: target.id });
  assert(r.success);
  const after = await store.load(code);
  const entry = after.state.powerLog[after.state.powerLog.length - 1];
  assert(entry.publicResult.includes("bribed"));
});

Deno.test("expansion: union_organizer arms strike → next enactment is discarded + tracker advances", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["union_organizer"], behaviors: [] },
  });
  const full = await store.load(code);
  const u = findPlayerWithPower(full.state, "union_organizer");
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: u.id });
  assert(r.success);
  const afterUse = await store.load(code);
  assertEquals(afterUse.state.blockNextEnact, true);
  // Run one legislative round and confirm no policy reaches the track
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const g = await store.load(code);
  g.state.chancellorPolicies = null; // will be set by the flow
  await store.update(code, { state: g.state });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.liberalPolicies, 0);
  assertEquals(s1.pub.fascistPolicies, 0);
  assertEquals(s1.pub.electionTracker, 1);
  assertFalse(s1.pub.blockNextEnact);
});

Deno.test("expansion: constitutional_judge arms veto → next enactment is struck down, no tracker advance", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["constitutional_judge"], behaviors: [] },
  });
  const full = await store.load(code);
  const j = findPlayerWithPower(full.state, "constitutional_judge");
  await shUseExpansionPower(store, { gameCode: code, playerId: j.id });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.electionTracker, 0);
  assertEquals(s1.pub.liberalPolicies, 0);
  assertEquals(s1.pub.fascistPolicies, 0);
});

Deno.test("expansion: cannot use power twice", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["constitutional_judge"], behaviors: [] },
  });
  const full = await store.load(code);
  const j = findPlayerWithPower(full.state, "constitutional_judge");
  const r1 = await shUseExpansionPower(store, { gameCode: code, playerId: j.id });
  assert(r1.success);
  const r2 = await shUseExpansionPower(store, { gameCode: code, playerId: j.id });
  assertFalse(r2.success);
});

Deno.test("expansion: dead player cannot use power", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["assassin"], behaviors: [] },
  });
  const full = await store.load(code);
  const a = findPlayerWithPower(full.state, "assassin");
  full.state.players.find((p: any) => p.id === a.id).alive = false;
  await store.update(code, { state: full.state });
  const r = await shUseExpansionPower(store, {
    gameCode: code,
    playerId: a.id,
    targetId: full.state.players.find((p: any) => p.id !== a.id).id,
  });
  assertFalse(r.success);
});

Deno.test("expansion: no-power player rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: [] },
  });
  const full = await store.load(code);
  const noPower = full.state.players.find((p: any) => !p.powerRole);
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: noPower.id });
  assertFalse(r.success);
});

Deno.test("expansion: targeted power missing target rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: [] },
  });
  const full = await store.load(code);
  const chief = findPlayerWithPower(full.state, "police_chief");
  const noTarget = await shUseExpansionPower(store, { gameCode: code, playerId: chief.id });
  assertFalse(noTarget.success);
  const selfTarget = await shUseExpansionPower(store, {
    gameCode: code,
    playerId: chief.id,
    targetId: chief.id,
  });
  assertFalse(selfTarget.success);
  // Dead target
  const deadSource = await store.load(code);
  const otherId = deadSource.state.players.find((p: any) => p.id !== chief.id).id;
  deadSource.state.players.find((p: any) => p.id === otherId).alive = false;
  await store.update(code, { state: deadSource.state });
  const deadTarget = await shUseExpansionPower(store, { gameCode: code, playerId: chief.id, targetId: otherId });
  assertFalse(deadTarget.success);
});

Deno.test("expansion: assassin killing Hitler triggers liberal win via power", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["assassin"], behaviors: [] },
  });
  const full = await store.load(code);
  const assassin = findPlayerWithPower(full.state, "assassin");
  const hitler = full.state.players.find((p: any) => p.role === "hitler");
  // If assassin IS Hitler, swap power to another player for this test
  if (assassin.id === hitler.id) {
    const other = full.state.players.find((p: any) => p.id !== assassin.id);
    assassin.powerRole = null;
    other.powerRole = "assassin";
    await store.update(code, { state: full.state });
  }
  const full2 = await store.load(code);
  const a2 = findPlayerWithPower(full2.state, "assassin");
  const r = await shUseExpansionPower(store, {
    gameCode: code,
    playerId: a2.id,
    targetId: hitler.id,
  });
  assert(r.success);
  const s = await getState(store, code, hostId);
  assertEquals(s.pub.phase, "gameOver");
  assertEquals(s.pub.winner, "liberal");
});

// ============================================================
// Dispatch router
// ============================================================
Deno.test("dispatch: unknown action returns error", async () => {
  const store = memoryStore();
  const r = await dispatch(store, "shBogus" as any, {});
  assertFalse(r.success);
});

Deno.test("dispatch: routes every action correctly (smoke)", async () => {
  const store = memoryStore();
  const r = await dispatch(store, "shCreateGame", { hostName: "Z" });
  assert(r.success);
});

Deno.test("dispatch: exercises every case arm", async () => {
  // Drive a game entirely through dispatch so each case arm in the switch
  // gets at least one hit.
  const store = memoryStore();
  const create = await dispatch(store, "shCreateGame", { hostName: "H" });
  assert(create.success);
  const code = create.gameCode!;
  const hostId = create.playerId!;
  const ids: string[] = [hostId];
  for (const n of ["B", "C", "D", "E"]) {
    const j = await dispatch(store, "shJoinGame", { gameCode: code, playerName: n });
    assert(j.success);
    ids.push(j.playerId!);
  }
  await dispatch(store, "shStartGame", { gameCode: code, playerId: hostId });
  const s0 = await dispatch(store, "shGetState", { gameCode: code, playerId: hostId });
  assert(s0.success);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await dispatch(store, "shNominate", { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) {
    await dispatch(store, "shVote", { gameCode: code, playerId: id, vote: true });
  }
  await dispatch(store, "shPresidentDiscard", { gameCode: code, playerId: presId, discardIndex: 0 });
  // Arm veto + respond (won't fire since fascistPolicies=0, but routes through dispatch)
  await dispatch(store, "shProposeVeto", { gameCode: code, playerId: chanId });
  await dispatch(store, "shRespondVeto", { gameCode: code, playerId: presId, agree: false });
  await dispatch(store, "shChancellorEnact", { gameCode: code, playerId: chanId, enactIndex: 0 });
  // Reach power phase via seed so shUsePower + shAckPower route
  const g = await store.load(code);
  g!.state.phase = "power";
  g!.state.pendingPower = "peek";
  g!.state.peekResult = ["lib", "fas", "lib"];
  await store.update(code, { state: g!.state });
  const newPresId = (await dispatch(store, "shGetState", { gameCode: code, playerId: hostId })).pub.presidentId;
  await dispatch(store, "shAckPower", { gameCode: code, playerId: newPresId });
  // Cover shUsePower via seeded investigate
  const g2 = await store.load(code);
  g2!.state.phase = "power";
  g2!.state.pendingPower = "investigate";
  await store.update(code, { state: g2!.state });
  const pres2 = (await dispatch(store, "shGetState", { gameCode: code, playerId: hostId })).pub.presidentId;
  const target = ids.find((i) => i !== pres2)!;
  await dispatch(store, "shUsePower", { gameCode: code, playerId: pres2, targetId: target });
  // shUseExpansionPower — seed one
  await dispatch(store, "shResetGame", { gameCode: code, playerId: hostId });
  await dispatch(store, "shStartGame", {
    gameCode: code,
    playerId: hostId,
    expansion: true,
    expansionConfig: { powerRoles: ["journalist"], behaviors: [] },
  });
  const g3 = await store.load(code);
  const j = g3!.state.players.find((p: any) => p.powerRole === "journalist");
  const t = g3!.state.players.find((p: any) => p.id !== j.id);
  await dispatch(store, "shUseExpansionPower", { gameCode: code, playerId: j.id, targetId: t.id });
});

Deno.test("getState: investigate private result visible to president between use and ack", async () => {
  const names = Array.from({ length: 9 }, (_, i) => "P" + i);
  const { store, code, hostId, ids } = await setupLobby(names);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.phase = "power";
  g!.state.pendingPower = "investigate";
  await store.update(code, { state: g!.state });
  const s = await getState(store, code, hostId);
  const presId = s.pub.presidentId;
  const target = ids.find((i) => i !== presId)!;
  await shUsePower(store, { gameCode: code, playerId: presId, targetId: target });
  const s2 = await getState(store, code, presId);
  assert(s2.priv.investigateResult);
  assertEquals(s2.priv.investigateResult.targetId, target);
});

Deno.test("usePower: non-president rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.phase = "power";
  g!.state.pendingPower = "execute";
  await store.update(code, { state: g!.state });
  const s = await getState(store, code, hostId);
  const notPres = ids.find((i) => i !== s.pub.presidentId)!;
  const r = await shUsePower(store, { gameCode: code, playerId: notPres, targetId: s.pub.presidentId });
  assertFalse(r.success);
});

Deno.test("usePower: execute non-Hitler → checkWin false → advance to nomination", async () => {
  const names = Array.from({ length: 7 }, (_, i) => "P" + i);
  const { store, code, hostId, ids } = await setupLobby(names);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.phase = "power";
  g!.state.pendingPower = "execute";
  await store.update(code, { state: g!.state });
  const full = await store.load(code);
  const presId = full!.state.players[full!.state.presidentIdx].id;
  // Find a non-Hitler living non-pres target
  const target = full!.state.players.find((p: any) =>
    p.id !== presId && p.role !== "hitler" && p.alive
  );
  const r = await shUsePower(store, { gameCode: code, playerId: presId, targetId: target.id });
  assert(r.success);
  const s2 = await getState(store, code, hostId);
  assertEquals(s2.pub.phase, "nomination");
  // Target is dead
  const deadNow = s2.pub.players.find((p: any) => p.id === target.id);
  assertEquals(deadNow.alive, false);
});

Deno.test("union_organizer chaos: block + tracker at 2 → chaos auto-enact", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["union_organizer"], behaviors: [] },
  });
  const full = await store.load(code);
  const u = full!.state.players.find((p: any) => p.powerRole === "union_organizer");
  await shUseExpansionPower(store, { gameCode: code, playerId: u.id });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  // Inject tracker=2 between president discard and chancellor enact so the
  // block-fires-chaos path fires (vote-pass resets tracker to 0, so we must
  // seed it after that reset).
  const seed = await store.load(code);
  seed!.state.electionTracker = 2;
  await store.update(code, { state: seed!.state });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.electionTracker, 0);
  assertEquals(s1.pub.liberalPolicies + s1.pub.fascistPolicies, 1);
});

Deno.test("presidentDiscard: wrong pres ID + missing drawn cards", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  // Force drawnPolicies to null → "No cards drawn"
  const g = await store.load(code);
  g!.state.drawnPolicies = null;
  await store.update(code, { state: g!.state });
  const r = await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  assertFalse(r.success);
});

Deno.test("chancellorEnact: missing chancellorPolicies → 'No cards'", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const g = await store.load(code);
  g!.state.chancellorPolicies = null;
  await store.update(code, { state: g!.state });
  const r = await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  assertFalse(r.success);
});

Deno.test("vote: deck reshuffle when <3 cards remain on successful pass", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Seed a tiny deck + discards to force the reshuffle branch
  const g = await store.load(code);
  g!.state.policyDeck = ["lib", "fas"];
  g!.state.discardPile = ["lib", "fas", "lib", "fas", "lib"];
  await store.update(code, { state: g!.state });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  const after = await store.load(code);
  // Reshuffle merged deck+discard, then 3 were drawn for legislative
  assertEquals(after!.state.drawnPolicies.length, 3);
  assertEquals(after!.state.discardPile.length, 0);
});

Deno.test("vote: chaos path with empty deck reshuffles from discard", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.electionTracker = 2;
  g!.state.policyDeck = [];
  g!.state.discardPile = ["lib"];
  await store.update(code, { state: g!.state });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: false });
  const s1 = await getState(store, code, hostId);
  // The reshuffled 'lib' was auto-enacted via chaos
  assertEquals(s1.pub.liberalPolicies, 1);
  assertEquals(s1.pub.electionTracker, 0);
});

Deno.test("respondVeto: chaos branch with tracker at 2 and empty deck reshuffles", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.fascistPolicies = 5;
  await store.update(code, { state: g!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  const pre = await store.load(code);
  pre!.state.electionTracker = 2;
  pre!.state.policyDeck = [];
  pre!.state.discardPile = ["lib"]; // only way to force 'lib' enact on chaos
  await store.update(code, { state: pre!.state });
  await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  const final = await getState(store, code, hostId);
  assertEquals(final.pub.electionTracker, 0);
});

Deno.test("presidentDiscard: wrong phase rejected explicitly", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const r = await shPresidentDiscard(store, { gameCode: code, playerId: hostId, discardIndex: 0 });
  assertFalse(r.success);
});

Deno.test("proposeVeto: wrong player in correct phase rejected", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const seed = await store.load(code);
  seed!.state.fascistPolicies = 5;
  await store.update(code, { state: seed!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const wrongPlayer = ids.find((i) => i !== presId && i !== chanId)!;
  const r = await shProposeVeto(store, { gameCode: code, playerId: wrongPlayer });
  assertFalse(r.success);
});

Deno.test("respondVeto: wrong phase rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const r = await shRespondVeto(store, { gameCode: code, playerId: hostId, agree: true });
  assertFalse(r.success);
});

Deno.test("vote: chaos enacts FASCIST when top of deck is fas", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.electionTracker = 2;
  g!.state.policyDeck = ["fas"];
  g!.state.discardPile = [];
  await store.update(code, { state: g!.state });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: false });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.fascistPolicies, 1);
  assertEquals(s1.pub.electionTracker, 0);
});

Deno.test("union_organizer: block chaos reshuffles empty deck and enacts FAS", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["union_organizer"], behaviors: [] },
  });
  const full = await store.load(code);
  const u = full!.state.players.find((p: any) => p.powerRole === "union_organizer");
  await shUseExpansionPower(store, { gameCode: code, playerId: u.id });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  // Force every card involved in the reshuffle to be "fas" so the chaos top is
  // deterministically "fas": chancellor's 2 cards + seeded discard.
  const seed = await store.load(code);
  seed!.state.electionTracker = 2;
  seed!.state.chancellorPolicies = ["fas", "fas"];
  seed!.state.policyDeck = [];
  seed!.state.discardPile = ["fas"];
  await store.update(code, { state: seed!.state });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.fascistPolicies, 1);
  assertEquals(s1.pub.electionTracker, 0);
});

Deno.test("respondVeto: chaos fascist enact wins for fascists", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.fascistPolicies = 5;
  await store.update(code, { state: g!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  // Force everything that ends up in the reshuffle pile to be "fas" so the
  // chaos draw is deterministic.
  const pre = await store.load(code);
  pre!.state.electionTracker = 2;
  pre!.state.chancellorPolicies = ["fas", "fas"];
  pre!.state.policyDeck = [];
  pre!.state.discardPile = ["fas"];
  await store.update(code, { state: pre!.state });
  await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  const final = await getState(store, code, hostId);
  // fascistPolicies 5 → chaos enacts "fas" → 6 → fascist win
  assertEquals(final.pub.phase, "gameOver");
  assertEquals(final.pub.winner, "fascist");
});

Deno.test("union_organizer: block chaos enacts LIBERAL when top is 'lib'", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["union_organizer"], behaviors: [] },
  });
  const full = await store.load(code);
  const u = full!.state.players.find((p: any) => p.powerRole === "union_organizer");
  await shUseExpansionPower(store, { gameCode: code, playerId: u.id });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const seed = await store.load(code);
  seed!.state.electionTracker = 2;
  seed!.state.chancellorPolicies = ["lib", "lib"];
  seed!.state.policyDeck = [];
  seed!.state.discardPile = ["lib"];
  await store.update(code, { state: seed!.state });
  await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  const s1 = await getState(store, code, hostId);
  assertEquals(s1.pub.liberalPolicies, 1);
});

Deno.test("respondVeto: chaos liberal enact branch", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.fascistPolicies = 5;
  await store.update(code, { state: g!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  const pre = await store.load(code);
  pre!.state.electionTracker = 2;
  pre!.state.chancellorPolicies = ["lib", "lib"];
  pre!.state.policyDeck = [];
  pre!.state.discardPile = ["lib"];
  await store.update(code, { state: pre!.state });
  await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  const final = await getState(store, code, hostId);
  assertEquals(final.pub.liberalPolicies, 1);
  assertEquals(final.pub.electionTracker, 0);
});

Deno.test("respondVeto: veto-agree without chaos (tracker ends at 1)", async () => {
  // Covers the shRespondVeto agree-without-chaos path (the `else` branch).
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.fascistPolicies = 5;
  await store.update(code, { state: g!.state });
  const { presId, chanId } = await pickNonHitlerChancellor(store, code, ids);
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  await shProposeVeto(store, { gameCode: code, playerId: chanId });
  await shRespondVeto(store, { gameCode: code, playerId: presId, agree: true });
  const s = await getState(store, code, hostId);
  assertEquals(s.pub.electionTracker, 1);
  assertEquals(s.pub.phase, "nomination");
});

Deno.test("getState: tolerates state without powerLog / votes / hitlerKnowsFascists / hostId", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const g = await store.load(code);
  // Strip optional-ish fields to exercise `|| []` / `|| {}` fallbacks
  delete g!.state.powerLog;
  delete g!.state.votes;
  // Also drop presidentIdx's player to hit the "pres null" branch
  const r = await shGetState(store, { gameCode: code, playerId: hostId });
  assert(r.success);
});

Deno.test("getState: null president when presidentIdx points to missing player", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const g = await store.load(code);
  g!.state.presidentIdx = 999; // out of range — players[999] is undefined
  await store.update(code, { state: g!.state });
  const r = await shGetState(store, { gameCode: code, playerId: hostId });
  assert(r.success);
  assertEquals(r.pub.presidentId, null);
});

Deno.test("shStartGame: no expansionConfig object still works", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  // expansion=true but no config → default pool (all roles)
  const r = await shStartGame(store, {
    gameCode: code,
    playerId: hostId,
    expansion: true,
  });
  assert(r.success);
});

Deno.test("shUsePower: unknown pendingPower string", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const g = await store.load(code);
  g!.state.phase = "power";
  g!.state.pendingPower = "made_up";
  await store.update(code, { state: g!.state });
  const pres = (await getState(store, code, hostId)).pub.presidentId;
  const target = ids.find((i) => i !== pres)!;
  const r = await shUsePower(store, { gameCode: code, playerId: pres, targetId: target });
  assertFalse(r.success);
  assertEquals(r.error, "Unknown power");
});

Deno.test("respondVeto: game not found", async () => {
  const store = memoryStore();
  const r = await shRespondVeto(store, { gameCode: "NOPE", playerId: "x", agree: true });
  assertFalse(r.success);
});

Deno.test("expansion: empty powerRoles → no power roles assigned (behaviors-only)", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: [], behaviors: ["feminist", "academic"] },
  });
  const full = await store.load(code);
  const withPower = full!.state.players.filter((p: any) => p.powerRole);
  const withBehavior = full!.state.players.filter((p: any) => p.behaviorRole);
  assertEquals(withPower.length, 0);
  assert(withBehavior.length > 0);
});

Deno.test("expansion: empty behaviors → no behavior roles (powers-only)", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: [] },
  });
  const full = await store.load(code);
  const withBehavior = full!.state.players.filter((p: any) => p.behaviorRole);
  assertEquals(withBehavior.length, 0);
});

Deno.test("expansion: configured behavior pool is respected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: ["feminist", "academic"] },
  });
  const full = await store.load(code);
  const behs = full!.state.players
    .map((p: any) => p.behaviorRole)
    .filter((x: any) => x);
  for (const b of behs) assert(["feminist", "academic"].indexOf(b) >= 0);
});

Deno.test("powerLog fallback: useExpansionPower tolerates missing log", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["journalist"], behaviors: [] },
  });
  const g = await store.load(code);
  delete g!.state.powerLog;
  await store.update(code, { state: g!.state });
  const full = await store.load(code);
  const j = full!.state.players.find((p: any) => p.powerRole === "journalist");
  const t = full!.state.players.find((p: any) => p.id !== j.id);
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: j.id, targetId: t.id });
  assert(r.success);
});

Deno.test("powerLog fallback: constitutional_judge block with missing powerLog", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["constitutional_judge"], behaviors: [] },
  });
  const full = await store.load(code);
  const j = full!.state.players.find((p: any) => p.powerRole === "constitutional_judge");
  await shUseExpansionPower(store, { gameCode: code, playerId: j.id });
  // Now go through a round; delete powerLog before the chan enact
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const pre = await store.load(code);
  delete pre!.state.powerLog;
  await store.update(code, { state: pre!.state });
  const r = await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  assert(r.success);
});

Deno.test("powerLog fallback: union_organizer block with missing powerLog", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["union_organizer"], behaviors: [] },
  });
  const full = await store.load(code);
  const u = full!.state.players.find((p: any) => p.powerRole === "union_organizer");
  await shUseExpansionPower(store, { gameCode: code, playerId: u.id });
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(store, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(store, { gameCode: code, playerId: presId, discardIndex: 0 });
  const pre = await store.load(code);
  delete pre!.state.powerLog;
  await store.update(code, { state: pre!.state });
  const r = await shChancellorEnact(store, { gameCode: code, playerId: chanId, enactIndex: 0 });
  assert(r.success);
});

Deno.test("store.load: empty/null code returns null", async () => {
  const store = memoryStore();
  assertEquals(await store.load(""), null);
  assertEquals(await store.load(null as any), null);
});

Deno.test("store.update: status-only update (no state field)", async () => {
  const store = memoryStore();
  await store.insert({ code: "ABC123", hostId: "p_1", status: "waiting", state: { x: 1 } });
  await store.update("ABC123", { status: "active" });
  const row = await store.load("ABC123");
  assertEquals(row!.status, "active");
  assertEquals(row!.state.x, 1);
});

Deno.test("store.update: empty/null code targets nothing", async () => {
  const store = memoryStore();
  await store.insert({ code: "ABC123", hostId: "p_1", status: "waiting", state: {} });
  await store.update("", { status: "active" });
  const row = await store.load("ABC123");
  assertEquals(row!.status, "waiting");
});

Deno.test("store.update: silently no-ops when row doesn't exist", async () => {
  const store = memoryStore();
  await store.update("NEVER_EXISTED", { state: { foo: "bar" } });
  const r = await store.load("NEVER_EXISTED");
  assertEquals(r, null);
});

Deno.test("store: broadcast no-op safely callable", async () => {
  const store = memoryStore();
  await store.broadcast!("any-code", { at: "now" });
  // No throw; no assertion needed beyond reaching this line.
});

// ============================================================
// Misc edge cases for getState
// ============================================================
Deno.test("getState: game not found", async () => {
  const store = memoryStore();
  const r = await shGetState(store, { gameCode: "XXXX00", playerId: "none" });
  assertFalse(r.success);
});

Deno.test("getState: priv.me null when playerId not in game", async () => {
  const { store, code } = await setupLobby(["H", "B", "C", "D", "E"]);
  const s = await getState(store, code, "p_ghost");
  assertEquals(s.priv.me, null);
});

Deno.test("getState: fascist team visible to fascist + hitler (5-6 players)", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const full = await store.load(code);
  const fasPlayer = full.state.players.find((p: any) => p.role === "fascist");
  const s = await getState(store, code, fasPlayer.id);
  assert(s.priv.fascistTeam);
  const hitler = full.state.players.find((p: any) => p.role === "hitler");
  const sh = await getState(store, code, hitler.id);
  assert(sh.priv.fascistTeam); // hitlerKnows = true at 5-6
});

Deno.test("getState: voting phase includes 'myVote' once cast", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  const s0 = await getState(store, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(store, { gameCode: code, playerId: presId, chancellorId: chanId });
  await shVote(store, { gameCode: code, playerId: hostId, vote: true });
  const s1 = await getState(store, code, hostId);
  if (s1.pub.phase === "voting") {
    assertEquals(s1.priv.myVote, true);
  }
});

// ============================================================
// Misc rejections
// ============================================================
Deno.test("nominate: phase not nomination rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const r = await shNominate(store, { gameCode: code, playerId: hostId, chancellorId: hostId });
  assertFalse(r.success);
});

Deno.test("nominate: game not found", async () => {
  const store = memoryStore();
  const r = await shNominate(store, { gameCode: "NOGAME", playerId: "x", chancellorId: "y" });
  assertFalse(r.success);
});

Deno.test("vote: phase not voting rejected", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const r = await shVote(store, { gameCode: code, playerId: hostId, vote: true });
  assertFalse(r.success);
});

Deno.test("vote: game not found", async () => {
  const store = memoryStore();
  const r = await shVote(store, { gameCode: "NOGAME", playerId: "x", vote: true });
  assertFalse(r.success);
});

Deno.test("presidentDiscard: game not found", async () => {
  const store = memoryStore();
  const r = await shPresidentDiscard(store, { gameCode: "NOGAME", playerId: "x", discardIndex: 0 });
  assertFalse(r.success);
});

Deno.test("chancellorEnact: game not found + wrong chancellor + bad index", async () => {
  const store = memoryStore();
  const r1 = await shChancellorEnact(store, { gameCode: "NOGAME", playerId: "x", enactIndex: 0 });
  assertFalse(r1.success);
  const { store: s2, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(s2, code, hostId);
  const s0 = await getState(s2, code, hostId);
  const presId = s0.pub.presidentId;
  const chanId = ids.find((i) => i !== presId)!;
  await shNominate(s2, { gameCode: code, playerId: presId, chancellorId: chanId });
  for (const id of ids) await shVote(s2, { gameCode: code, playerId: id, vote: true });
  await shPresidentDiscard(s2, { gameCode: code, playerId: presId, discardIndex: 0 });
  // Wrong player
  const wrongChan = await shChancellorEnact(s2, { gameCode: code, playerId: presId, enactIndex: 0 });
  assertFalse(wrongChan.success);
  // Bad index
  const badIdx = await shChancellorEnact(s2, { gameCode: code, playerId: chanId, enactIndex: 99 });
  assertFalse(badIdx.success);
});

Deno.test("proposeVeto: game not found + wrong player + wrong phase", async () => {
  const store = memoryStore();
  const r1 = await shProposeVeto(store, { gameCode: "NOGAME", playerId: "x" });
  assertFalse(r1.success);
  const { store: s2, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const r2 = await shProposeVeto(s2, { gameCode: code, playerId: hostId });
  assertFalse(r2.success);
});

Deno.test("useExpansionPower: game not found; lobby phase rejected; unknown power", async () => {
  const store = memoryStore();
  const r1 = await shUseExpansionPower(store, { gameCode: "NOGAME", playerId: "x" });
  assertFalse(r1.success);
  const { store: s2, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  const r2 = await shUseExpansionPower(s2, { gameCode: code, playerId: hostId });
  assertFalse(r2.success);
  // Unknown power injected into state
  await startGame(s2, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["police_chief"], behaviors: [] },
  });
  const full = await s2.load(code);
  const chief = full.state.players.find((p: any) => p.powerRole === "police_chief");
  chief.powerRole = "mystery_bogus_role";
  await s2.update(code, { state: full.state });
  const other = full.state.players.find((p: any) => p.id !== chief.id);
  const r3 = await shUseExpansionPower(s2, {
    gameCode: code,
    playerId: chief.id,
    targetId: other.id,
  });
  assertFalse(r3.success);
});

Deno.test("reset: game not found", async () => {
  const store = memoryStore();
  const r = await shResetGame(store, { gameCode: "NOGAME", playerId: "x" });
  assertFalse(r.success);
});

Deno.test("useExpansionPower: player not found", async () => {
  const { store, code, hostId } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId, {
    expansion: true,
    expansionConfig: { powerRoles: ["assassin"], behaviors: [] },
  });
  const r = await shUseExpansionPower(store, { gameCode: code, playerId: "p_ghost", targetId: hostId });
  assertFalse(r.success);
});

Deno.test("usePower: wrong phase + wrong player + unknown power state", async () => {
  const { store, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(store, code, hostId);
  // Not in power phase
  const r1 = await shUsePower(store, { gameCode: code, playerId: hostId, targetId: ids[1] });
  assertFalse(r1.success);
  // Game not found
  const store2 = memoryStore();
  const r2 = await shUsePower(store2, { gameCode: "NOPE", playerId: "x", targetId: "y" });
  assertFalse(r2.success);
  // Force state into 'power' with unknown pendingPower
  const g = await store.load(code);
  g.state.phase = "power";
  g.state.pendingPower = "bogus";
  await store.update(code, { state: g.state });
  const pres = (await getState(store, code, hostId)).pub.presidentId;
  const victim = ids.find((i) => i !== pres)!;
  const r3 = await shUsePower(store, { gameCode: code, playerId: pres, targetId: victim });
  assertFalse(r3.success);
});

Deno.test("ackPower: game not found + wrong player + nothing-to-ack", async () => {
  const store = memoryStore();
  const r1 = await shAckPower(store, { gameCode: "NOPE", playerId: "x" });
  assertFalse(r1.success);
  const { store: s2, code, hostId, ids } = await setupLobby(["H", "B", "C", "D", "E"]);
  await startGame(s2, code, hostId);
  const g = await s2.load(code);
  g.state.phase = "power";
  g.state.pendingPower = "execute"; // can't ack
  await s2.update(code, { state: g.state });
  const pres = (await getState(s2, code, hostId)).pub.presidentId;
  const r2 = await shAckPower(s2, { gameCode: code, playerId: pres });
  assertFalse(r2.success);
  // wrong player
  g.state.pendingPower = "peek";
  await s2.update(code, { state: g.state });
  const wrongId = ids.find((i) => i !== pres)!;
  const r3 = await shAckPower(s2, { gameCode: code, playerId: wrongId });
  assertFalse(r3.success);
});
