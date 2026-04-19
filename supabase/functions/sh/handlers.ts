// Secret Hitler handlers — pure functions that take a Store.
// Both the HTTP entry (index.ts) and the test suite drive these same handlers.
// deno-lint-ignore-file no-explicit-any

import {
  POWER_ROLES,
  BEHAVIOR_ROLES,
  shuffle,
  roleDist,
  buildDeck,
  currentPresident,
  eligibleChancellor,
  advancePresident,
  checkWin,
  applyEnact,
} from "./logic.ts";
import type { Store } from "./store.ts";

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

function freshState(hostId: string, hostName: string) {
  const now = new Date().toISOString();
  return {
    mode: "secrethitler",
    phase: "lobby",
    hostId,
    players: [{
      id: hostId,
      name: hostName.trim(),
      isHost: true,
      alive: true,
      role: null,
      party: null,
      hasBeenInvestigated: false,
    }],
    presidentIdx: 0,
    lastElectedPresident: null,
    lastElectedChancellor: null,
    nominatedChancellorId: null,
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    policyDeck: [] as string[],
    discardPile: [] as string[],
    drawnPolicies: null as string[] | null,
    chancellorPolicies: null as string[] | null,
    votes: {} as Record<string, boolean>,
    voteResult: null as any,
    vetoProposed: false,
    vetoRefused: false,
    pendingPower: null as string | null,
    peekResult: null as string[] | null,
    investigateResult: null as any,
    specialElectionActive: false,
    returnPresidentIdx: null as number | null,
    hitlerKnowsFascists: false,
    winner: null as string | null,
    winReason: null as string | null,
    powerLog: [] as any[],
    blockNextEnact: false,
    vetoNextEnact: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function saveGame(store: Store, code: string, state: any, status?: string) {
  state.updatedAt = new Date().toISOString();
  await store.update(code, { state, ...(status ? { status } : {}) });
  if (store.broadcast) {
    await store.broadcast(code, { at: state.updatedAt });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function shCreateGame(store: Store, p: any) {
  if (!p.hostName) return { success: false, error: "Host name required" };
  const hostId = genId();
  const code = genCode();
  const state = freshState(hostId, p.hostName);
  await store.insert({ code, hostId, status: "waiting", state });
  return { success: true, gameCode: code, playerId: hostId, isHost: true };
}

export async function shJoinGame(store: Store, p: any) {
  if (!p.gameCode || !p.playerName) return { success: false, error: "Game code and name required" };
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  const name = String(p.playerName).trim();
  if (p.rejoinId) {
    const existing = s.players.find((x: any) => x.id === p.rejoinId);
    if (existing) {
      return {
        success: true,
        gameCode: game.code,
        playerId: existing.id,
        isHost: !!existing.isHost,
        rejoined: true,
      };
    }
  }
  const byName = s.players.find((x: any) => x.name.toLowerCase() === name.toLowerCase());
  if (byName) {
    return {
      success: true,
      gameCode: game.code,
      playerId: byName.id,
      isHost: !!byName.isHost,
      rejoined: true,
    };
  }
  if (s.phase !== "lobby") return { success: false, error: "Game already started; name not recognized" };
  if (s.players.length >= 12) return { success: false, error: "Lobby full (max 12)" };
  const id = genId();
  s.players.push({
    id,
    name,
    isHost: false,
    alive: true,
    role: null,
    party: null,
    hasBeenInvestigated: false,
  });
  await saveGame(store, game.code, s);
  return { success: true, gameCode: game.code, playerId: id, isHost: false };
}

export async function shStartGame(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.hostId !== p.playerId) return { success: false, error: "Only host can start" };
  if (s.phase !== "lobby") return { success: false, error: "Already started" };
  const n = s.players.length;
  const dist = roleDist(n);
  if (!dist) return { success: false, error: `Need 5-12 players, have ${n}` };
  const roles: { role: string; party: string }[] = [];
  for (let i = 0; i < dist.lib; i++) roles.push({ role: "liberal", party: "liberal" });
  for (let i = 0; i < dist.fas; i++) roles.push({ role: "fascist", party: "fascist" });
  roles.push({ role: "hitler", party: "fascist" });
  const shuffledRoles = shuffle(roles);
  s.players = shuffle(s.players);
  const expansion = !!p.expansion;
  s.expansion = expansion;
  const cfg = p.expansionConfig || {};
  // Distinguish "not provided" (use full default) from "provided empty"
  // (user explicitly disabled that category — respect the empty list).
  const selectedPowerPool = Array.isArray(cfg.powerRoles)
    ? cfg.powerRoles.filter((r: string) => POWER_ROLES.indexOf(r) >= 0)
    : POWER_ROLES.slice();
  const selectedBehPool = Array.isArray(cfg.behaviors)
    ? cfg.behaviors.filter((b: string) => BEHAVIOR_ROLES.indexOf(b) >= 0)
    : BEHAVIOR_ROLES.slice();
  const powerQueue = expansion ? shuffle(selectedPowerPool.slice()) : [];
  const behQueue = expansion ? shuffle(selectedBehPool.slice()) : [];
  for (let i = 0; i < s.players.length; i++) {
    s.players[i].role = shuffledRoles[i].role;
    s.players[i].party = shuffledRoles[i].party;
    s.players[i].alive = true;
    s.players[i].hasBeenInvestigated = false;
    s.players[i].powerRole = null;
    s.players[i].behaviorRole = null;
    s.players[i].powerUsed = false;
    s.players[i].privatePowerResult = null;
    if (expansion) {
      if (powerQueue.length > 0) {
        s.players[i].powerRole = powerQueue.shift();
      } else if (behQueue.length > 0) {
        s.players[i].behaviorRole = behQueue.shift();
      }
    }
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
  s.powerLog = [];
  s.blockNextEnact = false;
  s.vetoNextEnact = false;
  await saveGame(store, game.code, s, "active");
  return { success: true };
}

export async function shGetState(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  const me = s.players.find((x: any) => x.id === p.playerId);
  const pres = currentPresident(s);
  const chan = s.nominatedChancellorId ? s.players.find((x: any) => x.id === s.nominatedChancellorId) : null;
  const pub: any = {
    phase: s.phase,
    powerLog: s.powerLog || [],
    blockNextEnact: !!s.blockNextEnact,
    vetoNextEnact: !!s.vetoNextEnact,
    players: s.players.map((x: any) => ({
      id: x.id,
      name: x.name,
      isHost: !!x.isHost,
      alive: !!x.alive,
      powerRole: x.powerRole || null,
      powerUsed: !!x.powerUsed,
    })),
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
      powerRole: s.phase === "lobby" ? null : (me.powerRole || null),
      behaviorRole: s.phase === "lobby" ? null : (me.behaviorRole || null),
      powerUsed: !!me.powerUsed,
    };
    if (me.privatePowerResult) priv.privatePowerResult = me.privatePowerResult;
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
    pub.allRoles = s.players.map((x: any) => ({
      id: x.id,
      name: x.name,
      role: x.role,
      party: x.party,
      alive: !!x.alive,
    }));
  }
  return { success: true, pub, priv };
}

export async function shNominate(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "nomination") return { success: false, error: "Not in nomination phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only current president can nominate" };
  if (!eligibleChancellor(s, pres.id, p.chancellorId)) return { success: false, error: "Ineligible chancellor" };
  s.nominatedChancellorId = p.chancellorId;
  s.votes = {};
  s.voteResult = null;
  s.phase = "voting";
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shVote(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
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
    s.voteResult = {
      passed,
      jas,
      total: alive.length,
      ballots,
      presidentId: currentPresident(s).id,
      chancellorId: s.nominatedChancellorId,
    };
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
        if (top === "lib") s.liberalPolicies++;
        else s.fascistPolicies++;
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
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shPresidentDiscard(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
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
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shChancellorEnact(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
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
  // Expansion power flags intercept the enactment
  if (s.vetoNextEnact) {
    s.discardPile.push(enacted);
    s.vetoNextEnact = false;
    s.powerLog = s.powerLog || [];
    s.powerLog.push({
      at: new Date().toISOString(),
      power: "constitutional_judge_fired",
      byName: "Constitutional Judge",
      publicResult: "Policy vetoed by judicial authority; tracker unchanged.",
      enacted: null,
    });
    advancePresident(s);
    s.nominatedChancellorId = null;
    s.phase = "nomination";
    await saveGame(store, game.code, s);
    return { success: true, vetoed: true };
  }
  if (s.blockNextEnact) {
    s.discardPile.push(enacted);
    s.blockNextEnact = false;
    s.electionTracker++;
    s.powerLog = s.powerLog || [];
    s.powerLog.push({
      at: new Date().toISOString(),
      power: "union_organizer_fired",
      byName: "Union Organizer",
      publicResult: "Strike! Policy discarded; election tracker advanced.",
      enacted: null,
    });
    if (s.electionTracker >= 3) {
      if (s.policyDeck.length < 1) {
        s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
        s.discardPile = [];
      }
      const top = s.policyDeck.splice(0, 1)[0];
      if (top === "lib") s.liberalPolicies++;
      else s.fascistPolicies++;
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
    await saveGame(store, game.code, s);
    return { success: true, blocked: true };
  }
  applyEnact(s, enacted, false);
  await saveGame(store, game.code, s);
  return { success: true, enacted };
}

export async function shProposeVeto(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativeChan") return { success: false, error: "Not in legislative chan phase" };
  if (p.playerId !== s.nominatedChancellorId) return { success: false, error: "Only chancellor can propose veto" };
  if (s.fascistPolicies < 5) return { success: false, error: "Veto unlocks after 5 Fascist policies" };
  s.vetoProposed = true;
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shRespondVeto(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "legislativeChan") return { success: false, error: "Not in legislative chan phase" };
  if (!s.vetoProposed) return { success: false, error: "No veto proposed" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can respond" };
  if (p.agree) {
    if (s.chancellorPolicies) {
      s.discardPile.push(...s.chancellorPolicies);
      s.chancellorPolicies = null;
    }
    s.vetoProposed = false;
    s.electionTracker++;
    if (s.electionTracker >= 3) {
      if (s.policyDeck.length < 1) {
        s.policyDeck = shuffle(s.policyDeck.concat(s.discardPile));
        s.discardPile = [];
      }
      const top = s.policyDeck.splice(0, 1)[0];
      if (top === "lib") s.liberalPolicies++;
      else s.fascistPolicies++;
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
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shUsePower(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "power") return { success: false, error: "Not in power phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can use power" };
  if (s.pendingPower === "peek") {
    return { success: false, error: "Peek is shown automatically. Use shAckPower to continue." };
  }
  const target = s.players.find((x: any) => x.id === p.targetId);
  if (!target) return { success: false, error: "Target not found" };
  if (!target.alive) return { success: false, error: "Target is dead" };
  if (target.id === pres.id) return { success: false, error: "Cannot target self" };
  s.powerLog = s.powerLog || [];
  const now = new Date().toISOString();
  if (s.pendingPower === "investigate") {
    if (target.hasBeenInvestigated) return { success: false, error: "Already investigated" };
    target.hasBeenInvestigated = true;
    s.investigateResult = { targetId: target.id, name: target.name, party: target.party };
    // Public log: names only — result stays private to the President.
    s.powerLog.push({
      at: now,
      power: "executive_investigate",
      by: pres.id, byName: pres.name,
      targetId: target.id, targetName: target.name,
      publicResult: pres.name + " investigated " + target.name + " (result is secret).",
    });
    await saveGame(store, game.code, s);
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
    s.powerLog.push({
      at: now,
      power: "executive_special_election",
      by: pres.id, byName: pres.name,
      targetId: target.id, targetName: target.name,
      publicResult: pres.name + " called a Special Election — " + target.name + " becomes the next President.",
    });
    await saveGame(store, game.code, s);
    return { success: true };
  }
  if (s.pendingPower === "execute") {
    target.alive = false;
    s.pendingPower = null;
    s.powerLog.push({
      at: now,
      power: "executive_execute",
      by: pres.id, byName: pres.name,
      targetId: target.id, targetName: target.name,
      publicResult: pres.name + " executed " + target.name + ".",
    });
    if (!checkWin(s)) {
      advancePresident(s);
      s.nominatedChancellorId = null;
      s.phase = "nomination";
    }
    await saveGame(store, game.code, s);
    return { success: true };
  }
  return { success: false, error: "Unknown power" };
}

export async function shAckPower(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase !== "power") return { success: false, error: "Not in power phase" };
  const pres = currentPresident(s);
  if (!pres || pres.id !== p.playerId) return { success: false, error: "Only president can ack" };
  if (s.pendingPower !== "peek" && s.pendingPower !== "investigate") return { success: false, error: "Nothing to ack" };
  // Log peek publicly (no results leaked — only that it happened).
  // Investigate is already logged at use-time in shUsePower.
  if (s.pendingPower === "peek") {
    s.powerLog = s.powerLog || [];
    s.powerLog.push({
      at: new Date().toISOString(),
      power: "executive_peek",
      by: pres.id, byName: pres.name,
      publicResult: pres.name + " peeked at the top 3 policies (contents secret).",
    });
  }
  s.pendingPower = null;
  s.peekResult = null;
  s.investigateResult = null;
  advancePresident(s);
  s.nominatedChancellorId = null;
  s.phase = "nomination";
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shUseExpansionPower(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.phase === "lobby" || s.phase === "gameOver") return { success: false, error: "Not during play" };
  const me = s.players.find((x: any) => x.id === p.playerId);
  if (!me) return { success: false, error: "Player not found" };
  if (!me.alive) return { success: false, error: "Dead players cannot use powers" };
  if (!me.powerRole) return { success: false, error: "You have no expansion power" };
  if (me.powerUsed) return { success: false, error: "Already used your power" };
  const power = me.powerRole;
  const now = new Date().toISOString();
  s.powerLog = s.powerLog || [];
  let privateResult: any = null;
  const needsTarget = ["police_chief", "assassin", "journalist", "industrialist"].indexOf(power) >= 0;
  let target: any = null;
  if (needsTarget) {
    target = s.players.find((x: any) => x.id === p.targetId);
    if (!target) return { success: false, error: "Target required" };
    if (target.id === me.id) return { success: false, error: "Cannot target self" };
    if (!target.alive) return { success: false, error: "Target must be alive" };
  }
  if (power === "police_chief") {
    privateResult = { targetId: target.id, name: target.name, party: target.party };
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      targetId: target.id, targetName: target.name,
      publicResult: me.name + " investigated " + target.name + " (result is secret).",
    });
  } else if (power === "assassin") {
    target.alive = false;
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      targetId: target.id, targetName: target.name,
      publicResult: me.name + " ASSASSINATED " + target.name + ".",
    });
    if (checkWin(s)) {
      me.powerUsed = true;
      await saveGame(store, game.code, s);
      return { success: true };
    }
  } else if (power === "journalist") {
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      targetId: target.id, targetName: target.name,
      publicResult: me.name + " exposes " + target.name + " as " +
        (target.party === "liberal" ? "LIBERAL" : "FASCIST") + ".",
    });
  } else if (power === "industrialist") {
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      targetId: target.id, targetName: target.name,
      publicResult: me.name + " bribed " + target.name + " (effect resolved socially).",
    });
  } else if (power === "union_organizer") {
    s.blockNextEnact = true;
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      publicResult: me.name + " calls a STRIKE. The next policy enactment will be discarded and the election tracker will advance.",
    });
  } else if (power === "constitutional_judge") {
    s.vetoNextEnact = true;
    s.powerLog.push({
      at: now, power, by: me.id, byName: me.name,
      publicResult: me.name + " raises a JUDICIAL VETO. The next policy enactment will be struck down with no tracker effect.",
    });
  } else {
    return { success: false, error: "Unknown power" };
  }
  me.powerUsed = true;
  if (privateResult) me.privatePowerResult = privateResult;
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shKickPlayer(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.hostId !== p.playerId) return { success: false, error: "Only host can kick" };
  if (s.phase !== "lobby") return { success: false, error: "Can only kick in the lobby" };
  if (!p.targetId) return { success: false, error: "Target required" };
  if (p.targetId === s.hostId) return { success: false, error: "Host cannot kick themselves" };
  const idx = s.players.findIndex((x: any) => x.id === p.targetId);
  if (idx === -1) return { success: false, error: "Player not in this game" };
  s.players.splice(idx, 1);
  await saveGame(store, game.code, s);
  return { success: true };
}

export async function shResetGame(store: Store, p: any) {
  const game = await store.load(p.gameCode);
  if (!game) return { success: false, error: "Game not found" };
  const s = game.state;
  if (s.hostId !== p.playerId) return { success: false, error: "Only host can reset" };
  s.phase = "lobby";
  s.players.forEach((x: any) => {
    x.role = null;
    x.party = null;
    x.alive = true;
    x.hasBeenInvestigated = false;
    x.powerRole = null;
    x.behaviorRole = null;
    x.powerUsed = false;
    x.privatePowerResult = null;
  });
  s.powerLog = [];
  s.blockNextEnact = false;
  s.vetoNextEnact = false;
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
  await saveGame(store, game.code, s, "waiting");
  return { success: true };
}

// Router helper the HTTP layer (or any other driver) can call.
export async function dispatch(store: Store, action: string, body: any) {
  switch (action) {
    case "shCreateGame": return await shCreateGame(store, body);
    case "shJoinGame": return await shJoinGame(store, body);
    case "shStartGame": return await shStartGame(store, body);
    case "shGetState": return await shGetState(store, body);
    case "shNominate": return await shNominate(store, body);
    case "shVote": return await shVote(store, body);
    case "shPresidentDiscard": return await shPresidentDiscard(store, body);
    case "shChancellorEnact": return await shChancellorEnact(store, body);
    case "shProposeVeto": return await shProposeVeto(store, body);
    case "shRespondVeto": return await shRespondVeto(store, body);
    case "shUsePower": return await shUsePower(store, body);
    case "shAckPower": return await shAckPower(store, body);
    case "shUseExpansionPower": return await shUseExpansionPower(store, body);
    case "shKickPlayer": return await shKickPlayer(store, body);
    case "shResetGame": return await shResetGame(store, body);
    default: return { success: false, error: "Unknown action: " + action };
  }
}
