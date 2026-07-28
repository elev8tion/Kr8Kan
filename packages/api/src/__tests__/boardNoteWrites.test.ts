import { describe, expect, it, vi } from "vitest";

/**
 * S7 read-your-writes: serialization alone does not fix the lost append —
 * NCB reads lag writes, so a queued writer's getNote can echo the note as
 * it was before the previous queued write committed. The writer must
 * prefer its own last written content when the DB read is a stale prefix
 * of it, while a genuinely different external edit still wins.
 */

const getNote = vi.fn();
const upsertNote = vi.fn();

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    boardNoteRepo: {
      ...actual.boardNoteRepo,
      getNote: (...args: unknown[]) => getNote(...args),
      upsertNote: (...args: unknown[]) => upsertNote(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { writeBoardNoteSerialized } from "../boardNoteWrites";

const db = {} as Database;

const append = (boardId: number, body: string) =>
  writeBoardNoteSerialized(db, {
    boardId,
    body,
    mode: "append",
    separatorLabel: "test",
    userId: "u1",
    agentIdentityId: null,
  });

const lastContent = () =>
  upsertNote.mock.calls.at(-1)?.[1]?.content as string | undefined;

describe("writeBoardNoteSerialized read-your-writes", () => {
  it("keeps both appends when every DB read echoes the pre-write note", async () => {
    // NCB never catches up within the test: reads always return the seed.
    getNote.mockResolvedValue({ content: "base" });
    upsertNote.mockResolvedValue(undefined);

    await Promise.all([append(101, "ALPHA"), append(101, "BETA")]);

    const final = lastContent();
    expect(final).toContain("base");
    expect(final).toContain("ALPHA");
    expect(final).toContain("BETA");
  });

  it("a non-prefix external edit inside the window wins over the cache", async () => {
    getNote.mockResolvedValue({ content: "seed" });
    upsertNote.mockResolvedValue(undefined);
    await append(102, "FIRST"); // primes the cache for board 102

    // A human replaced the note; the DB read is not a prefix of our write.
    getNote.mockResolvedValue({ content: "human rewrite" });
    await append(102, "SECOND");

    const final = lastContent();
    expect(final).toContain("human rewrite");
    expect(final).toContain("SECOND");
    expect(final).not.toContain("FIRST");
  });

  it("an append after replace bases on the replace even when reads lag", async () => {
    getNote.mockResolvedValue(undefined); // DB never shows the note yet
    upsertNote.mockResolvedValue(undefined);

    await writeBoardNoteSerialized(db, {
      boardId: 103,
      body: "REPLACED",
      mode: "replace",
      separatorLabel: "test",
      userId: "u1",
      agentIdentityId: null,
    });
    await append(103, "AFTER");

    const final = lastContent();
    expect(final).toContain("REPLACED");
    expect(final).toContain("AFTER");
  });
});
