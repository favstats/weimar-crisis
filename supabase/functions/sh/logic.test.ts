// Deno unit tests for Secret Hitler game logic.
// Run:  deno test supabase/functions/sh/logic.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  POWER_ROLES, BEHAVIOR_ROLES,
  shuffle, roleDist, buildDeck,
  currentPresident, eligibleChancellor, advancePresident,
  checkWin, triggerPowerAfterEnact, applyEnact, makePlayer,
} from "./logic.ts";

// --- Helpers ---
function makeGame(playerCount: number, opts: Partial<any> = {}): any {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(makePlayer("p" + i, "P" + i));
  }
  return {
    phase: "nomination",
    players,
    presidentIdx: 0,
    lastElectedPresident: null,
    lastElectedChancellor: null,
    nominatedChancellorId: null,
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    policyDeck: ["lib", "lib", "lib", "fas", "fas", "fas"],
    discardPile: [],
    drawnPolicies: null,
    chancellorPolicies: null,
    votes: {},
    voteResult: null,
    vetoProposed: false,
    pendingPower: null,
    peekResult: null,
    investigateResult: null,
    specialElectionActive: false,
    returnPresidentIdx: null,
    winner: null,
    winReason: null,
    ...opts,
  };
}

// ============================================================
// roleDist
// ============================================================
Deno.test("roleDist: 5 players — 3L/1F/H, Hitler knows", () => {
  assertEquals(roleDist(5), { lib: 3, fas: 1, hitlerKnows: true });
});
Deno.test("roleDist: 6 players — Hitler still knows", () => {
  assertEquals(roleDist(6), { lib: 4, fas: 1, hitlerKnows: true });
});
Deno.test("roleDist: 7 players — Hitler no longer knows", () => {
  assertEquals(roleDist(7), { lib: 4, fas: 2, hitlerKnows: false });
});
Deno.test("roleDist: 10 players — full count, Hitler blind", () => {
  assertEquals(roleDist(10), { lib: 6, fas: 3, hitlerKnows: false });
});
Deno.test("roleDist: 11 players (XL) — 6L/4F/H", () => {
  assertEquals(roleDist(11), { lib: 6, fas: 4, hitlerKnows: false });
});
Deno.test("roleDist: 12 players (XL) — 7L/4F/H", () => {
  assertEquals(roleDist(12), { lib: 7, fas: 4, hitlerKnows: false });
});
Deno.test("roleDist: below 5 and above 12 returns null", () => {
  assertEquals(roleDist(4), null);
  assertEquals(roleDist(13), null);
  assertEquals(roleDist(0), null);
});
Deno.test("roleDist: each count's lib+fas+1(Hitler) equals player count", () => {
  for (let n = 5; n <= 12; n++) {
    const d = roleDist(n)!;
    assertEquals(d.lib + d.fas + 1, n, `failed for ${n} players`);
  }
});

// ============================================================
// buildDeck
// ============================================================
Deno.test("buildDeck: exactly 17 cards", () => {
  assertEquals(buildDeck().length, 17);
});
Deno.test("buildDeck: 6 Liberal + 11 Fascist", () => {
  const d = buildDeck();
  assertEquals(d.filter((c) => c === "lib").length, 6);
  assertEquals(d.filter((c) => c === "fas").length, 11);
});

// ============================================================
// shuffle
// ============================================================
Deno.test("shuffle: preserves length", () => {
  assertEquals(shuffle([1, 2, 3, 4, 5]).length, 5);
});
Deno.test("shuffle: preserves contents (multiset)", () => {
  const input = ["a", "b", "c", "a", "b"];
  const out = shuffle(input).sort();
  assertEquals(out, ["a", "a", "b", "b", "c"]);
});
Deno.test("shuffle: does not mutate input", () => {
  const input = [1, 2, 3];
  const before = input.slice();
  shuffle(input);
  assertEquals(input, before);
});

// ============================================================
// eligibleChancellor
// ============================================================
Deno.test("eligibleChancellor: president cannot nominate self", () => {
  const s = makeGame(7);
  assertFalse(eligibleChancellor(s, "p0", "p0"));
});
Deno.test("eligibleChancellor: cannot nominate dead player", () => {
  const s = makeGame(7);
  s.players[2].alive = false;
  assertFalse(eligibleChancellor(s, "p0", "p2"));
});
Deno.test("eligibleChancellor: cannot nominate last chancellor", () => {
  const s = makeGame(7);
  s.lastElectedChancellor = "p3";
  assertFalse(eligibleChancellor(s, "p0", "p3"));
});
Deno.test("eligibleChancellor: cannot nominate last president when >5 alive", () => {
  const s = makeGame(7);
  s.lastElectedPresident = "p3";
  assertFalse(eligibleChancellor(s, "p0", "p3"));
});
Deno.test("eligibleChancellor: CAN nominate last president when exactly 5 alive", () => {
  const s = makeGame(7);
  s.lastElectedPresident = "p3";
  // Kill 2 players to get down to 5 alive
  s.players[4].alive = false;
  s.players[5].alive = false;
  assertEquals(s.players.filter((p: any) => p.alive).length, 5);
  assert(eligibleChancellor(s, "p0", "p3"));
});
Deno.test("eligibleChancellor: last chancellor still ineligible even at 5 alive", () => {
  const s = makeGame(7);
  s.lastElectedChancellor = "p2";
  s.players[4].alive = false;
  s.players[5].alive = false;
  assertFalse(eligibleChancellor(s, "p0", "p2"));
});
Deno.test("eligibleChancellor: eligible target returns true", () => {
  const s = makeGame(7);
  assert(eligibleChancellor(s, "p0", "p3"));
});

// ============================================================
// advancePresident
// ============================================================
Deno.test("advancePresident: moves to next alive player", () => {
  const s = makeGame(5);
  s.presidentIdx = 0;
  advancePresident(s);
  assertEquals(s.presidentIdx, 1);
});
Deno.test("advancePresident: skips dead players", () => {
  const s = makeGame(5);
  s.presidentIdx = 0;
  s.players[1].alive = false;
  s.players[2].alive = false;
  advancePresident(s);
  assertEquals(s.presidentIdx, 3);
});
Deno.test("advancePresident: wraps around to start of array", () => {
  const s = makeGame(5);
  s.presidentIdx = 4;
  advancePresident(s);
  assertEquals(s.presidentIdx, 0);
});
Deno.test("advancePresident: all-dead pathological state — loop exits without finding an alive player", () => {
  const s = makeGame(5);
  s.players.forEach((p: any) => { p.alive = false; });
  const startIdx = s.presidentIdx;
  advancePresident(s);
  // Loop wraps back to startIdx without finding an alive player; presidentIdx ends at startIdx
  assertEquals(s.presidentIdx, startIdx);
});

Deno.test("advancePresident: after special election returns to player left of original", () => {
  const s = makeGame(7);
  s.presidentIdx = 4; // current pres during special election
  s.specialElectionActive = true;
  s.returnPresidentIdx = 2; // original pres before special was p2
  advancePresident(s);
  // Should restore to p2, then advance to p3
  assertEquals(s.presidentIdx, 3);
  assertEquals(s.specialElectionActive, false);
  assertEquals(s.returnPresidentIdx, null);
});

// ============================================================
// checkWin
// ============================================================
Deno.test("checkWin: 5 liberal policies → liberal victory", () => {
  const s = makeGame(5);
  s.liberalPolicies = 5;
  assert(checkWin(s));
  assertEquals(s.winner, "liberal");
  assertEquals(s.phase, "gameOver");
});
Deno.test("checkWin: 6 fascist policies → fascist victory", () => {
  const s = makeGame(5);
  s.fascistPolicies = 6;
  assert(checkWin(s));
  assertEquals(s.winner, "fascist");
});
Deno.test("checkWin: Hitler killed → liberal victory", () => {
  const s = makeGame(5);
  s.players[0].role = "hitler";
  s.players[0].alive = false;
  assert(checkWin(s));
  assertEquals(s.winner, "liberal");
  assertEquals(s.winReason, "Hitler executed");
});
Deno.test("checkWin: no win condition met → false, phase unchanged", () => {
  const s = makeGame(5);
  s.players[0].role = "hitler";
  s.players[0].alive = true;
  s.liberalPolicies = 3;
  s.fascistPolicies = 4;
  s.phase = "nomination";
  assertFalse(checkWin(s));
  assertEquals(s.winner, null);
  assertEquals(s.phase, "nomination");
});

// ============================================================
// triggerPowerAfterEnact
// ============================================================
Deno.test("triggerPowerAfterEnact: liberal policy never triggers power", () => {
  const s = makeGame(7);
  s.fascistPolicies = 4;
  assertEquals(triggerPowerAfterEnact(s, "lib"), null);
});
Deno.test("triggerPowerAfterEnact: 5-6 players → peek at 3F, execute at 4F/5F", () => {
  const s = makeGame(6);
  s.fascistPolicies = 1; assertEquals(triggerPowerAfterEnact(s, "fas"), null);
  s.fascistPolicies = 2; assertEquals(triggerPowerAfterEnact(s, "fas"), null);
  s.fascistPolicies = 3; assertEquals(triggerPowerAfterEnact(s, "fas"), "peek");
  s.fascistPolicies = 4; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
  s.fascistPolicies = 5; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
});
Deno.test("triggerPowerAfterEnact: 7-8 players → investigate@2, specialElection@3, execute@4/5", () => {
  const s = makeGame(7);
  s.fascistPolicies = 1; assertEquals(triggerPowerAfterEnact(s, "fas"), null);
  s.fascistPolicies = 2; assertEquals(triggerPowerAfterEnact(s, "fas"), "investigate");
  s.fascistPolicies = 3; assertEquals(triggerPowerAfterEnact(s, "fas"), "specialElection");
  s.fascistPolicies = 4; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
  s.fascistPolicies = 5; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
});
Deno.test("triggerPowerAfterEnact: 9-10 players → investigate@1/2, specialElection@3, execute@4/5", () => {
  const s = makeGame(10);
  s.fascistPolicies = 1; assertEquals(triggerPowerAfterEnact(s, "fas"), "investigate");
  s.fascistPolicies = 2; assertEquals(triggerPowerAfterEnact(s, "fas"), "investigate");
  s.fascistPolicies = 3; assertEquals(triggerPowerAfterEnact(s, "fas"), "specialElection");
  s.fascistPolicies = 4; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
  s.fascistPolicies = 5; assertEquals(triggerPowerAfterEnact(s, "fas"), "execute");
});

// ============================================================
// applyEnact
// ============================================================
Deno.test("applyEnact: liberal policy increments liberal track", () => {
  const s = makeGame(5);
  applyEnact(s, "lib", false);
  assertEquals(s.liberalPolicies, 1);
  assertEquals(s.phase, "nomination");
});
Deno.test("applyEnact: fascist policy increments fascist track", () => {
  const s = makeGame(5);
  applyEnact(s, "fas", false);
  assertEquals(s.fascistPolicies, 1);
});
Deno.test("applyEnact: 5th liberal policy triggers win", () => {
  const s = makeGame(5);
  s.liberalPolicies = 4;
  applyEnact(s, "lib", false);
  assertEquals(s.phase, "gameOver");
  assertEquals(s.winner, "liberal");
});
Deno.test("applyEnact: 6th fascist policy triggers win", () => {
  const s = makeGame(5);
  s.fascistPolicies = 5;
  applyEnact(s, "fas", false);
  assertEquals(s.phase, "gameOver");
  assertEquals(s.winner, "fascist");
});
Deno.test("applyEnact: fascist policy at power threshold → phase=power", () => {
  const s = makeGame(7);
  s.fascistPolicies = 1;
  applyEnact(s, "fas", false);
  assertEquals(s.phase, "power");
  assertEquals(s.pendingPower, "investigate");
});
Deno.test("applyEnact: chaos enactment skips power trigger", () => {
  const s = makeGame(7);
  s.fascistPolicies = 1;
  applyEnact(s, "fas", true); // fromChaos = true
  assertEquals(s.phase, "nomination");
  assertEquals(s.pendingPower, null);
});
Deno.test("applyEnact: peek power populates peekResult from deck top", () => {
  const s = makeGame(5);
  s.fascistPolicies = 2;
  s.policyDeck = ["lib", "fas", "fas", "lib", "fas"];
  applyEnact(s, "fas", false);
  assertEquals(s.phase, "power");
  assertEquals(s.pendingPower, "peek");
  assertEquals(s.peekResult, ["lib", "fas", "fas"]);
});
Deno.test("applyEnact: peek power reshuffles discard when deck has <3 cards", () => {
  const s = makeGame(5);
  s.fascistPolicies = 2;
  // Only 2 cards in deck — reshuffle from discard required
  s.policyDeck = ["lib", "fas"];
  s.discardPile = ["fas", "lib", "fas", "lib"];
  applyEnact(s, "fas", false);
  assertEquals(s.phase, "power");
  assertEquals(s.pendingPower, "peek");
  // After reshuffle, policyDeck has all 6 cards (2 original + 4 from discard)
  // and discardPile is empty
  assertEquals(s.policyDeck.length, 6);
  assertEquals(s.discardPile.length, 0);
  assertEquals(s.peekResult!.length, 3);
  // Every revealed card is a real policy type
  for (const c of s.peekResult!) {
    assert(c === "lib" || c === "fas");
  }
});
Deno.test("applyEnact: advances president when no power triggered", () => {
  const s = makeGame(5);
  s.presidentIdx = 1;
  applyEnact(s, "lib", false);
  assertEquals(s.presidentIdx, 2);
  assertEquals(s.nominatedChancellorId, null);
});
Deno.test("applyEnact: does NOT advance president when power is triggered", () => {
  const s = makeGame(7);
  s.fascistPolicies = 1;
  s.presidentIdx = 3;
  applyEnact(s, "fas", false);
  // President stays put to execute the power
  assertEquals(s.presidentIdx, 3);
});

// ============================================================
// Role & behavior lookup arrays
// ============================================================
Deno.test("POWER_ROLES: 6 unique entries", () => {
  assertEquals(POWER_ROLES.length, 6);
  assertEquals(new Set(POWER_ROLES).size, 6);
});
Deno.test("BEHAVIOR_ROLES: 16 unique entries", () => {
  assertEquals(BEHAVIOR_ROLES.length, 16);
  assertEquals(new Set(BEHAVIOR_ROLES).size, 16);
});

// ============================================================
// currentPresident
// ============================================================
Deno.test("currentPresident: returns player at presidentIdx", () => {
  const s = makeGame(5);
  s.presidentIdx = 2;
  assertEquals(currentPresident(s).id, "p2");
});

// ============================================================
// Integration-ish: full 3-failed-election chaos sequence
// ============================================================
Deno.test("full sequence: 3 failed elections + chaos enactment does not trigger power", () => {
  const s = makeGame(7);
  // Simulate 2 fascist policies already, chaos would be the 3rd fas
  s.fascistPolicies = 1;
  // Chaos enacts the top policy from deck; we force it to 'fas'
  s.policyDeck = ["fas"];
  applyEnact(s, "fas", true); // chaos = true; bumps to 2 fas, but no power
  assertEquals(s.fascistPolicies, 2);
  assertEquals(s.pendingPower, null);
  assertEquals(s.phase, "nomination");
});
