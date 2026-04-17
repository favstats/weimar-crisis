// Pure Secret Hitler game logic — no DB, no HTTP. Unit-testable.
// deno-lint-ignore-file no-explicit-any

export const POWER_ROLES: string[] = [
  "police_chief", "assassin", "journalist",
  "industrialist", "union_organizer", "constitutional_judge",
];

export const BEHAVIOR_ROLES: string[] = [
  "feminist", "misogynist", "aristocrat", "proletarian",
  "pacifist", "militarist", "monarchist", "revolutionary",
  "prussian", "bavarian", "devout", "atheist",
  "academic", "worker", "veteran", "hothead",
];

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function roleDist(n: number) {
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

export function buildDeck(): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 6; i++) deck.push("lib");
  for (let i = 0; i < 11; i++) deck.push("fas");
  return shuffle(deck);
}

export function currentPresident(s: any) {
  return s.players[s.presidentIdx];
}

export function eligibleChancellor(s: any, presId: string, targetId: string): boolean {
  if (presId === targetId) return false;
  const target = s.players.find((p: any) => p.id === targetId);
  if (!target || !target.alive) return false;
  const alive = s.players.filter((p: any) => p.alive).length;
  if (targetId === s.lastElectedChancellor) return false;
  if (alive > 5 && targetId === s.lastElectedPresident) return false;
  return true;
}

export function advancePresident(s: any): void {
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

export function checkWin(s: any): boolean {
  if (s.liberalPolicies >= 5) {
    s.winner = "liberal";
    s.winReason = "5 Liberal policies enacted";
    s.phase = "gameOver";
    return true;
  }
  if (s.fascistPolicies >= 6) {
    s.winner = "fascist";
    s.winReason = "6 Fascist policies enacted";
    s.phase = "gameOver";
    return true;
  }
  const hitler = s.players.find((p: any) => p.role === "hitler");
  if (hitler && !hitler.alive) {
    s.winner = "liberal";
    s.winReason = "Hitler executed";
    s.phase = "gameOver";
    return true;
  }
  return false;
}

export function triggerPowerAfterEnact(s: any, policy: string): string | null {
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

export function applyEnact(s: any, policy: string, fromChaos: boolean): void {
  if (policy === "lib") s.liberalPolicies++;
  else s.fascistPolicies++;
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

export function makePlayer(id: string, name: string, opts: Partial<any> = {}) {
  return {
    id, name,
    isHost: false,
    alive: true,
    role: null as string | null,
    party: null as string | null,
    hasBeenInvestigated: false,
    powerRole: null as string | null,
    behaviorRole: null as string | null,
    powerUsed: false,
    ...opts,
  };
}
