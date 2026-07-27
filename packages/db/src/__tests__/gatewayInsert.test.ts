import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbRow } from "../ncb/http";
import * as http from "../ncb/http";
import { NcbGateway } from "../ncb/gateway";

/**
 * NcbGateway.insert invariant (S2 hardening): an insert that returns
 * success MUST correspond to a persisted row attributable to that
 * insert; an ambiguous (5xx) create is resolved by probing the unique
 * business key (publicId, or spec.probeKeys composite) across the NCB
 * read-lag window before one bounded re-create; an unconfirmable
 * insert THROWS — it never fabricates a row.
 */

vi.mock("../ncb/http", () => ({
  createRow: vi.fn(),
  listRows: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
}));

const createRow = vi.mocked(http.createRow);
const listRows = vi.mocked(http.listRows);

const cfg = { instance: "t", secretKey: "s", dataApiUrl: "http://ncb.test" };
const gateway = () => new NcbGateway(cfg);

/** Equality-filter store, the way the real listRows behaves (NCB may
 * return numeric columns as strings, so compare stringly). */
function serveRows(rows: DbRow[]) {
  listRows.mockImplementation(
    async (_cfg, table, filters = {}, limit) => {
      const hit = rows.filter(
        (r) =>
          (r._table ?? "") === table &&
          Object.entries(filters).every(
            ([k, v]) => v === null || String(r[k]) === String(v),
          ),
      );
      const cleaned = hit.map(({ _table, ...rest }) => rest);
      return limit !== undefined ? cleaned.slice(0, limit) : cleaned;
    },
  );
}

/** Drive the pending insert through its internal sleep() timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined); // avoid unhandled rejection while timers run
  await vi.runAllTimersAsync();
  return p;
}

const messageValues = {
  publicId: "739vhg6yjihv",
  channelId: 4,
  body: "pagination filler message number 8",
  createdBy: "user-1",
};

const messageRow: DbRow & { _table?: string } = {
  _table: "message",
  id: 12,
  public_id: "739vhg6yjihv",
  channel_id: 4,
  body: "pagination filler message number 8",
  created_by: "user-1",
  parent_message_id: null,
  agent_identity_id: null,
  edited_at: null,
  created_at: "2026-07-27 11:38:53",
  updated_at: "2026-07-27 11:38:53",
  deleted_at: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  createRow.mockReset();
  listRows.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ambiguous 5xx create (publicId probe)", () => {
  it("returns the already-committed row without re-creating", async () => {
    createRow.mockRejectedValueOnce(new Error("NCB 500: Error creating record"));
    serveRows([messageRow]);

    const row = await settle(gateway().insert("messages", messageValues));

    expect(row.publicId).toBe("739vhg6yjihv");
    expect(row.body).toBe("pagination filler message number 8");
    expect(createRow).toHaveBeenCalledTimes(1); // no duplicate create
  });

  it("re-creates exactly once when probes prove the row never landed", async () => {
    const rows: (DbRow & { _table?: string })[] = [];
    serveRows(rows);
    createRow
      .mockRejectedValueOnce(new Error("NCB 500: Error creating record"))
      .mockImplementationOnce(async () => {
        rows.push({ ...messageRow });
        return 12;
      });

    const row = await settle(gateway().insert("messages", messageValues));

    expect(row.id).toBe(12);
    expect(createRow).toHaveBeenCalledTimes(2);
  });

  it("probes across the read-lag window (multiple probes, not one)", async () => {
    createRow.mockRejectedValue(new Error("NCB 500: Error creating record"));
    serveRows([]);

    const p = gateway().insert("messages", messageValues);
    await expect(settle(p)).rejects.toThrow(); // second create also 500s
    // probe GETs before the re-create: one per configured probe delay
    const probeCalls = listRows.mock.calls.filter(
      (c) => (c[2] as DbRow)?.public_id === "739vhg6yjihv",
    );
    expect(probeCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("rethrows immediately when the insert has no probeable key", async () => {
    const err = new Error("NCB 500: Error creating record");
    createRow.mockRejectedValueOnce(err);
    serveRows([]);

    await expect(
      settle(gateway().insert("activities", { cardId: 1, type: "moved" })),
    ).rejects.toBe(err);
    expect(listRows).not.toHaveBeenCalled();
  });
});

describe("ambiguous 5xx create (auditLog composite probeKeys)", () => {
  const auditValues = {
    workspaceId: 7,
    seq: 42,
    eventType: "card.created",
    entityType: "card",
    prevHash: "a".repeat(64),
    hash: "b".repeat(64),
    payload: null,
    createdAt: new Date("2026-07-27T11:39:00Z"),
  };
  const auditRowBase: DbRow & { _table?: string } = {
    _table: "audit_log",
    id: 900,
    workspace_id: 7,
    seq: 42,
    event_type: "card.created",
    entity_type: "card",
    entity_public_id: null,
    actor_user_id: null,
    actor_agent_id: null,
    payload: "null",
    prev_hash: "a".repeat(64),
    hash: "b".repeat(64),
    created_at: "2026-07-27 11:39:00",
  };

  it("recognizes its own committed row by matching scalars (hash)", async () => {
    createRow.mockRejectedValueOnce(new Error("NCB 500: Error creating record"));
    serveRows([auditRowBase]);

    const row = await settle(gateway().insert("auditLog", auditValues));

    expect(row.seq).toBe(42);
    expect(row.hash).toBe("b".repeat(64));
    expect(createRow).toHaveBeenCalledTimes(1);
  });

  it("throws (no duplicate create) when a racing writer holds the (workspaceId, seq) slot", async () => {
    const err = new Error("NCB 500: Error creating record");
    createRow.mockRejectedValueOnce(err);
    serveRows([{ ...auditRowBase, hash: "z".repeat(64), event_type: "card.updated" }]);

    await expect(settle(gateway().insert("auditLog", auditValues))).rejects.toBe(err);
    expect(createRow).toHaveBeenCalledTimes(1); // never re-creates over a taken slot
  });
});

describe("read-back verification after a successful create", () => {
  it("throws instead of fabricating a row when the create is never readable", async () => {
    createRow.mockResolvedValueOnce(12);
    serveRows([]);

    await expect(settle(gateway().insert("messages", messageValues))).rejects.toThrow(
      /created message row 12 not readable/,
    );
  });

  it("falls back to the publicId probe when the NCB-returned id does not read back", async () => {
    createRow.mockResolvedValueOnce(9999); // wrong/laggy numeric id
    serveRows([{ ...messageRow, id: 12 }]); // real row readable only by public_id

    const row = await settle(gateway().insert("messages", messageValues));

    expect(row.publicId).toBe("739vhg6yjihv");
    expect(row.id).toBe(12);
  });

  it("retries the read across the lag window before succeeding", async () => {
    const rows: (DbRow & { _table?: string })[] = [];
    serveRows(rows);
    createRow.mockImplementationOnce(async () => {
      // row becomes readable only after the first read attempt misses
      setTimeout(() => rows.push({ ...messageRow }), 500);
      return 12;
    });

    const row = await settle(gateway().insert("messages", messageValues));

    expect(row.id).toBe(12);
    expect(createRow).toHaveBeenCalledTimes(1);
  });
});
