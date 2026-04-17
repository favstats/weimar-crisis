// Storage abstraction so the handlers can be driven against either Supabase
// Postgres (production) or an in-memory map (tests).
// deno-lint-ignore-file no-explicit-any

export interface StoredGame {
  code: string;
  hostId: string;
  status: string;
  state: any;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  load(code: string): Promise<StoredGame | null>;
  insert(row: Omit<StoredGame, "createdAt" | "updatedAt">): Promise<void>;
  update(code: string, patch: { state?: any; status?: string }): Promise<void>;
  broadcast?(code: string, payload: any): Promise<void>;
}

// In-memory store used by tests. Preserves the same semantics the real
// Postgres-backed store has from the handlers' point of view.
export function memoryStore(): Store {
  const rows = new Map<string, StoredGame>();
  return {
    async load(code) {
      const c = (code || "").toUpperCase().trim();
      return rows.get(c) ?? null;
    },
    async insert(row) {
      const now = new Date().toISOString();
      rows.set(row.code, { ...row, createdAt: now, updatedAt: now });
    },
    async update(code, patch) {
      const c = (code || "").toUpperCase().trim();
      const existing = rows.get(c);
      if (!existing) return;
      rows.set(c, {
        ...existing,
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date().toISOString(),
      });
    },
    async broadcast(_code, _payload) {
      // No-op for tests.
    },
  };
}
