// Secret Hitler — Supabase Edge Function
// Deploy: `supabase functions deploy sh --no-verify-jwt`
// Env vars required (set automatically by Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// ---------- helpers ----------
function genCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "0123456789";
  let c = "";
  for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 2; i++) c += digits[Math.floor(Math.random() * digits.length)];
  return c;
}

function genId(): string {
  return "p_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roleDist(n: number) {
  switch (n) {
    case 5: return { lib: 3, fas: 1, hitlerKnows: true };
    case 6: return { lib: 4, fas: 1, hitlerKnows: true };
    case 7: return { lib: 4, fas: 2, hitlerKnows: false };
    case 8: return { lib: 5, fas: 2, hitlerKnows: false };
    case 9: return { lib: 5, fas: 3, hitlerKnows: false };
    case 10: return { lib: 6, fas: 3, hitlerKnows: false };
    default: return null;
  }
}

function buildDeck(): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 6; i++) deck.push("lib");
  for (let i = 0; i < 11; i++) deck.push("fas");
  return shuffle(deck);
}

function currentPresident(s: any) { return s.players[s.presidentIdx]; }

function eligibleChancellor(s: any, presId: string, targetId: string) {
  if (presId === targetId) return false;
  const target = s.players.find((p: any) => p.id === targetId);
  if (!target || !target.alive) return false;
  const alive = s.players.filter((p: any) => p.alive).length;
  if (targetId === s.lastElectedChancellor) return false;
  if (alive > 5 && targetId === s.lastElectedPresident) return false;
  return true;
}

function advancePresident(s: any) {
  if (s.specialElectionActive) {
    s.presidentIdx = s.returnPresidentIdx;
    s.specialElectionActive = false;
    s.returnPresidentIdx = null;
  }
  for (let i = 0; i < s.players.length; i++) {
    s.presidentIdx = (s.presidentIdx + 1) % s.players.length;
    if (s.players[s.presidentIdx].alive) return;
  }
}

function checkWin(s: any): boolean {
  if (s.liberalPolicies >= 5) { s.winner = "liberal"; s.winReason = "5 Liberal policies enacted"; s.phase = "gameOver"; return true; }
  if (s.fascistPolicies >= 6) { s.winner = "fascist"; s.winReason = "6 Fascist policies enacted"; s.phase = "gameOver"; return true; }
  const hitler = s.players.find((p: any) => p.role === "hitler");
  if (hitler && !hitler.alive) { s.winner = "liberal"; s.winReason = "Hitler executed"; s.phase = "gameOver"; return true; }
  return false;
}

function triggerPowerAfterEnact(s: any, policy: string): string | null {
  if (policy !== "fas") return null;
  const n = s.players.length;
  const f = s.fascistPolicies;
  if (n <= 6) {
    if (f === 3) return "peek";
    if (f === 4 || f === 5) return "execute";
  } else if (n <= 8) {
    if (f === 2) return "investigate";
    if (f === 3) return "specialElection";
    if (f === 4 || f === 5) return "execute";
  } else {
    if (f === 1 || f === 2) return "investigate";
    if (f === 3) return "specialElection";
    if (f === 4 || f === 5) return "execute";
  }
  return null;
}

function applyEnact(s: any, policy: string, fromChaos: boolean) {
  if (policy === "lib") s.liberalPolicies++; else s.fascistPolicies++;
  if (checkWin(s)) return;
  const power = fromChaos ? null : triggerPowerAfterEnact(s, policy);
  if (power) {
    s.pendingPower = power;
    s.peekResult = null;
    s.investigateResult = null;
    if (power === "peek") {
      if (s.policyDeck.length < 3) {
        s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
        s.discardPile = [];
      }
      s.peekResult = s.policyDeck.slice(0, 3);
    }
    s.phase = "power";
  } else {
    advancePresident(s);
    s.nominatedChancellorId = null;
    s.phase = "nomination";
  }
}

// ---------- load / save / broadcast ----------
async function loadGame(code: string) {
  const c = (code || "").toUpperCase().trim();
  const sb = admin();
  const { data, error } = await sb.from("sh_games").select("*").eq("code", c).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveGame(code: string, state: any, status?: string) {
  const sb = admin();
  const patch: any = { state, updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  const { error } = await sb.from("sh_games").update(patch).eq("code", code);
  if (error) throw error;
  // Broadcast ping on the game channel so clients re-fetch their filtered view.
  try {
    const channel = sb.channel(`sh:${code}`, { config: { broadcast: { self: true, ack: false } } });
    await channel.subscribe();
    await channel.send({ type: "broadcast", event: "update", payload: { at: patch.updated_at } });
    await channel.unsubscribe();
  } catch (_) {
    // Best-effort; polling fallback exists client-side.
  }
}

function freshState(hostId: string, hostName: string) {
  const now = new Date().toISOString();
  return {
    mode: "secrethitler",
    phase: "lobby",
    hostId,
    players: [{ id: hostId, name: hostName.trim(), isHost: true, alive: true, role: null, party: null, hasBeenInvestigated: false }],
    presidentIdx: 0,
    lastElectedPresident: null,
    lastElectedChancellor: null,
    nominatedChancellorId: null,
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    policyDeck: [],
    discardPile: [],
    drawnPolicies: null,
    chancellorPolicies: null,
    votes: {},
    voteResult: null,
    vetoProposed: false,
    vetoRefused: false,
    pendingPower: null,
    peekResult: null,
    investigateResult: null,
    specialElectionActive: false,
    returnPresidentIdx: null,
    hitlerKnowsFascists: false,
    winner: null,
    winReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- actions ----------
async function shCreateGame(p: any) {
  if (!p.hostName) return { success: false, error: "Host name required" };
  const hostId = genId();
  const code = genCode();
  const state = freshState(hostId, p.hostName);
  const sb = admin();
  const { error } = await sb.from("sh_games").insert({ code, host_id: hostId, status: "waiting", state });
  if (error) return { success: false, error: error.message };
  return { success: true, gameCode: code, playerId: hostId, isHost: true };
}

async function shJoinGame(p: any) {
  if (!p.gameCode || !p.playerName) return { success: false, error: "Game code and name required" };
  const game = await loadGame(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  const name = String(p.playerName).trim();
  if (p.rejoinId) {
    const existing = s.players.find((x: any) => x.id === p.rejoinId);
    if (existing) return { success: true, gameCode: game.code, playerId: existing.id, isHost: !!existing.isHost, rejoined: true };
  }
  const existingByName = s.players.find((x: any) => x.name.toLowerCase() === name.toLowerCase());
  if (existingByName) return { success: true, gameCode: game.code, playerId: existingByName.id, isHost: !!existingByName.isHost, rejoined: true };
  if (s.phase !== "lobby") return { success: false, error: "Game already started; name not recognized" };
  if (s.players.length >= 10) return { success: false, error: "Lobby full (max 10)" };
  const id = genId();
  s.players.push({ id, name, isHost: false, alive: true, role: null, party: null, hasBeenInvestigated: false });
  await saveGame(game.code, s);
  return { success: true, gameCode: game.code, playerId: id, isHost: false };
}

async function shStartGame(p: any) {
  const game = await loadGame(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.hostId !== p.playerId) return { success: false, error: "Only host can start" };
  if (s.phase !== "lobby") return { success: false, error: "Already started" };
  const n = s.players.length;
  const dist = roleDist(n);
  if (!dist) return { success: false, error: `Need 5-10 players, have ${n}` };
  const roles: { role: string; party: string }[] = [];
  for (let i = 0; i < dist.lib; i++) roles.push({ role: "liberal", party: "liberal" });
  for (let i = 0; i < dist.fas; i++) roles.push({ role: "fascist", party: "fascist" });
  roles.push({ role: "hitler", party: "fascist" });
  const shuffledRoles = shuffle(roles);
  s.players = shuffle(s.players);
  for (let i = 0; i < s.players.length; i++) {
    s.players[i].role = shuffledRoles[i].role;
    s.players[i].party = shuffledRoles[i].party;
    s.players[i].alive = true;
    s.players[i].hasBeenInvestigated = false;
  }
  s.hitlerKnowsFascists = dist.hitlerKnows;
  s.policyDeck = buildDeck();
  s.discardPile = [];
  s.liberalPolicies = 0;
  s.fascistPolicies = 0;
  s.electionTracker = 0;
  s.presidentIdx = 0;
  s.lastElectedPresident = null;
  s.lastElectedChancellor = null;
  s.nominatedChancellorId = null;
  s.votes = {};
  s.voteResult = null;
  s.drawnPolicies = null;
  s.chancellorPolicies = null;
  s.vetoProposed = false;
  s.vetoRefused = false;
  s.pendingPower = null;
  s.peekResult = null;
  s.investigateResult = null;
  s.specialElectionActive = false;
  s.returnPresidentIdx = null;
  s.winner = null;
  s.winReason = null;
  s.phase = "nomination";
  await saveGame(game.code, s, "active");
  return { success: true };
}

async function shGetState(p: any) {
  const game = await loadGame(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  const me = s.players.find((x: any) => x.id === p.playerId);
  const pres = currentPresident(s);
  const chan = s.nominatedChancellorId ? s.players.find((x: any) => x.id === s.nominatedChancellorId) : null;
  const pub: any = {
    phase: s.phase,
    players: s.players.map((x: any) => ({ id: x.id, name: x.name, isHost: !!x.isHost, alive: !!x.alive })),
    hostId: s.hostId,
    presidentId: pres ? pres.id : null,
    chancellorId: chan ? chan.id : null,
    liberalPolicies: s.liberalPolicies,
    fascistPolicies: s.fascistPolicies,
    electionTracker: s.electionTracker,
    deckCount: s.policyDeck.length,
    discardCount: s.discardPile.length,
    lastElectedPresident: s.lastElectedPresident,
    lastElectedChancellor: s.lastElectedChancellor,
    voteResult: s.voteResult,
    pendingPower: s.pendingPower,
    vetoProposed: s.vetoProposed,
    hitlerKnowsFascists: !!s.hitlerKnowsFascists,
    winner: s.winner,
    winReason: s.winReason,
    votesCast: Object.keys(s.votes || {}),
    updatedAt: s.updatedAt,
  };
  const priv: any = { me: null };
  if (me) {
    priv.me = {
      id: me.id,
      name: me.name,
      isHost: !!me.isHost,
      alive: !!me.alive,
      role: s.phase === "lobby" ? null : me.role,
      party: s.phase === "lobby" ? null : me.party,
      hasBeenInvestigated: !!me.hasBeenInvestigated,
    };
    if (s.phase !== "lobby" && me.party === "fascist" && (me.role !== "hitler" || s.hitlerKnowsFascists)) {
      priv.fascistTeam = s.players
        .filter((x: any) => x.party === "fascist")
        .map((x: any) => ({ id: x.id, name: x.name, role: x.role }));
    }
    if (s.phase === "legislativePres" && pres && pres.id === me.id && s.drawnPolicies) {
      priv.drawnPolicies = s.drawnPolicies.slice();
    }
    if (s.phase === "legislativeChan" && chan && chan.id === me.id && s.chancellorPolicies) {
      priv.chancellorPolicies = s.chancellorPolicies.slice();
    }
    if (s.pendingPower === "peek" && pres && pres.id === me.id && s.peekResult) {
      priv.peekResult = s.peekResult.slice();
    }
    if (s.pendingPower === "investigate" && pres && pres.id === me.id && s.investigateResult) {
      priv.investigateResult = s.investigateResult;
    }
    if (s.phase === "voting" && Object.prototype.hasOwnProperty.call(s.votes, me.id)) {
      priv.myVote = s.votes[me.id];
    }
  }
  if (s.voteResult && s.voteResult.ballots) pub.voteBallots = s.voteResult.ballots;
  if (s.phase === "gameOver") {
    pub.allRoles = s.players.map((x: any) => ({ id: x.id, name: x.name, role: x.role, party: x.party, alive: !!x.alive }));
  }
  return { success: true, pub, priv };
}

async function shNominate(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "nomination") return { success: false, error: "Not in nomination phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only current president can nominate" };
  if (!eligibleChancellor(s, pres.id, p.chancellorId)) return { success: false, error: "Ineligible chancellor" };
  s.nominatedChancellorId = p.chancellorId;
  s.votes = {};
  s.voteResult = null;
  s.phase = "voting";
  await saveGame(game.code, s);
  return { success: true };
}

async function shVote(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "voting") return { success: false, error: "Not in voting phase" };
  const me = s.players.find((x: any) => x.id === p.playerId);
  if (!me || !me.alive) return { success: false, error: "Only alive players can vote" };
  s.votes[p.playerId] = !!p.vote;
  const alive = s.players.filter((x: any) => x.alive);
  const cast = alive.filter((x: any) => Object.prototype.hasOwnProperty.call(s.votes, x.id));
  if (cast.length === alive.length) {
    const jas = alive.filter((x: any) => s.votes[x.id] === true).length;
    const passed = jas > alive.length / 2;
    const ballots = alive.map((x: any) => ({ id: x.id, name: x.name, vote: s.votes[x.id] }));
    s.voteResult = { passed, jas, total: alive.length, ballots, presidentId: currentPresident(s).id, chancellorId: s.nominatedChancellorId };
    if (passed) {
      const chan = s.players.find((x: any) => x.id === s.nominatedChancellorId);
      if (chan && chan.role === "hitler" && s.fascistPolicies >= 3) {
        s.winner = "fascist";
        s.winReason = "Hitler elected Chancellor after 3 Fascist policies";
        s.phase = "gameOver";
      } else {
        s.lastElectedPresident = currentPresident(s).id;
        s.lastElectedChancellor = s.nominatedChancellorId;
        s.electionTracker = 0;
        if (s.policyDeck.length < 3) {
          s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
          s.discardPile = [];
        }
        s.drawnPolicies = s.policyDeck.splice(0, 3);
        s.phase = "legislativePres";
      }
    } else {
      s.electionTracker++;
      if (s.electionTracker >= 3) {
        if (s.policyDeck.length < 1) {
          s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
          s.discardPile = [];
        }
        const top = s.policyDeck.splice(0, 1)[0];
        if (top === "lib") s.liberalPolicies++; else s.fascistPolicies++;
        s.electionTracker = 0;
        s.lastElectedPresident = null;
        s.lastElectedChancellor = null;
        s.voteResult.chaosPolicy = top;
        if (!checkWin(s)) {
          advancePresident(s);
          s.nominatedChancellorId = null;
          s.phase = "nomination";
        }
      } else {
        advancePresident(s);
        s.nominatedChancellorId = null;
        s.phase = "nomination";
      }
    }
  }
  await saveGame(game.code, s);
  return { success: true };
}

async function shPresidentDiscard(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativePres") return { success: false, error: "Not in legislative pres phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can discard" };
  if (!s.drawnPolicies || s.drawnPolicies.length !== 3) return { success: false, error: "No cards drawn" };
  const i = Number(p.discardIndex);
  if (i < 0 || i > 2) return { success: false, error: "Bad index" };
  const [discarded] = s.drawnPolicies.splice(i, 1);
  s.discardPile.push(discarded);
  s.chancellorPolicies = s.drawnPolicies.slice();
  s.drawnPolicies = null;
  s.phase = "legislativeChan";
  s.vetoProposed = false;
  await saveGame(game.code, s);
  return { success: true };
}

async function shChancellorEnact(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativeChan") return { success: false, error: "Not in legislative chan phase" };
  if (p.playerId !== s.nominatedChancellorId) return { success: false, error: "Only chancellor can enact" };
  if (!s.chancellorPolicies || s.chancellorPolicies.length !== 2) return { success: false, error: "No cards" };
  const i = Number(p.enactIndex);
  if (i < 0 || i > 1) return { success: false, error: "Bad index" };
  const [enacted] = s.chancellorPolicies.splice(i, 1);
  s.discardPile.push(s.chancellorPolicies[0]);
  s.chancellorPolicies = null;
  s.vetoProposed = false;
  applyEnact(s, enacted, false);
  await saveGame(game.code, s);
  return { success: true, enacted };
}

async function shProposeVeto(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativeChan") return { success: false, error: "Not in legislative chan phase" };
  if (p.playerId !== s.nominatedChancellorId) return { success: false, error: "Only chancellor can propose veto" };
  if (s.fascistPolicies < 5) return { success: false, error: "Veto unlocks after 5 Fascist policies" };
  s.vetoProposed = true;
  await saveGame(game.code, s);
  return { success: true };
}

async function shRespondVeto(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativeChan") return { success: false, error: "Not in legislative chan phase" };
  if (!s.vetoProposed) return { success: false, error: "No veto proposed" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can respond" };
  if (p.agree) {
    if (s.chancellorPolicies) { s.discardPile.push(...s.chancellorPolicies); s.chancellorPolicies = null; }
    s.vetoProposed = false;
    s.electionTracker++;
    if (s.electionTracker >= 3) {
      if (s.policyDeck.length < 1) {
        s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
        s.discardPile = [];
      }
      const top = s.policyDeck.splice(0, 1)[0];
      if (top === "lib") s.liberalPolicies++; else s.fascistPolicies++;
      s.electionTracker = 0;
      s.lastElectedPresident = null;
      s.lastElectedChancellor = null;
      if (!checkWin(s)) {
        advancePresident(s);
        s.nominatedChancellorId = null;
        s.phase = "nomination";
      }
    } else {
      advancePresident(s);
      s.nominatedChancellorId = null;
      s.phase = "nomination";
    }
  } else {
    s.vetoProposed = false;
    s.vetoRefused = true;
  }
  await saveGame(game.code, s);
  return { success: true };
}

async function shUsePower(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "power") return { success: false, error: "Not in power phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can use power" };
  if (s.pendingPower === "peek") return { success: false, error: "Peek is shown automatically; call shAckPower to continue" };
  const target = s.players.find((x: any) => x.id === p.targetId);
  if (!target) return { success: false, error: "Target not found" };
  if (!target.alive) return { success: false, error: "Target is dead" };
  if (target.id === pres.id) return { success: false, error: "Cannot target self" };
  if (s.pendingPower === "investigate") {
    if (target.hasBeenInvestigated) return { success: false, error: "Already investigated" };
    target.hasBeenInvestigated = true;
    s.investigateResult = { targetId: target.id, name: target.name, party: target.party };
    await saveGame(game.code, s);
    return { success: true };
  }
  if (s.pendingPower === "specialElection") {
    const targetIdx = s.players.findIndex((x: any) => x.id === target.id);
    if (!s.specialElectionActive) {
      s.specialElectionActive = true;
      s.returnPresidentIdx = s.presidentIdx;
    }
    s.presidentIdx = targetIdx;
    s.pendingPower = null;
    s.nominatedChancellorId = null;
    s.phase = "nomination";
    await saveGame(game.code, s);
    return { success: true };
  }
  if (s.pendingPower === "execute") {
    target.alive = false;
    s.pendingPower = null;
    if (!checkWin(s)) {
      advancePresident(s);
      s.nominatedChancellorId = null;
      s.phase = "nomination";
    }
    await saveGame(game.code, s);
    return { success: true };
  }
  return { success: false, error: "Unknown power" };
}

async function shAckPower(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "power") return { success: false, error: "Not in power phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can ack" };
  if (s.pendingPower !== "peek" && s.pendingPower !== "investigate") return { success: false, error: "Nothing to ack" };
  s.pendingPower = null;
  s.peekResult = null;
  s.investigateResult = null;
  advancePresident(s);
  s.nominatedChancellorId = null;
  s.phase = "nomination";
  await saveGame(game.code, s);
  return { success: true };
}

async function shResetGame(p: any) {
  const game = await loadGame(p.gameCode); if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.hostId !== p.playerId) return { success: false, error: "Only host can reset" };
  s.phase = "lobby";
  s.players.forEach((x: any) => { x.role = null; x.party = null; x.alive = true; x.hasBeenInvestigated = false; });
  s.policyDeck = [];
  s.discardPile = [];
  s.drawnPolicies = null;
  s.chancellorPolicies = null;
  s.votes = {};
  s.voteResult = null;
  s.vetoProposed = false;
  s.vetoRefused = false;
  s.pendingPower = null;
  s.peekResult = null;
  s.investigateResult = null;
  s.specialElectionActive = false;
  s.returnPresidentIdx = null;
  s.liberalPolicies = 0;
  s.fascistPolicies = 0;
  s.electionTracker = 0;
  s.presidentIdx = 0;
  s.lastElectedPresident = null;
  s.lastElectedChancellor = null;
  s.nominatedChancellorId = null;
  s.winner = null;
  s.winReason = null;
  await saveGame(game.code, s, "waiting");
  return { success: true };
}

// ---------- router ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ success: false, error: "Bad JSON" }, 400); }
  const action = body?.action;
  try {
    switch (action) {
      case "shCreateGame": return json(await shCreateGame(body));
      case "shJoinGame": return json(await shJoinGame(body));
      case "shStartGame": return json(await shStartGame(body));
      case "shGetState": return json(await shGetState(body));
      case "shNominate": return json(await shNominate(body));
      case "shVote": return json(await shVote(body));
      case "shPresidentDiscard": return json(await shPresidentDiscard(body));
      case "shChancellorEnact": return json(await shChancellorEnact(body));
      case "shProposeVeto": return json(await shProposeVeto(body));
      case "shRespondVeto": return json(await shRespondVeto(body));
      case "shUsePower": return json(await shUsePower(body));
      case "shAckPower": return json(await shAckPower(body));
      case "shResetGame": return json(await shResetGame(body));
      default: return json({ success: false, error: "Unknown action: " + action }, 400);
    }
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
