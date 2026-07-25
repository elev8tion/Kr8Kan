import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import * as channelRepo from "../repository/channel";
import * as schema from "../schema";

/**
 * Wave C channel surfaces, against real migrations: trash restore with
 * parent-chain (message restores its channel), 30-day trash scoping,
 * message FTS (migration 0011), and the /my channel-activity derivation.
 */
let db: Database;
let workspaceId: number;
const userA = "user-a";
const userB = "user-b";

beforeAll(async () => {
  const pglite = new PGlite();
  db = drizzle(pglite, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: "migrations" });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ publicId: generateUID(), name: "Test", slug: "test" })
    .returning();
  workspaceId = ws!.id;
  await db.insert(schema.user).values([
    { id: userA, name: "Alice", email: "a@test.dev" },
    { id: userB, name: "Bob", email: "b@test.dev" },
  ]);
});

async function makeChannel(name: string) {
  const channel = await channelRepo.createChannel(db, {
    workspaceId,
    name,
    slug: name,
    userId: userA,
  });
  return channel!;
}

describe("trash restore parent chain", () => {
  it("restoring a message restores its deleted channel too", async () => {
    const channel = await makeChannel("doomed");
    const message = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "still here after the flood",
      userId: userA,
    });
    await channelRepo.softDeleteMessage(db, message!.id);
    await channelRepo.softDeleteChannel(db, channel.id);

    expect(await channelRepo.getChannelByPublicId(db, channel.publicId)).toBeUndefined();

    await channelRepo.restoreMessage(db, message!.id);

    const restoredChannel = await channelRepo.getChannelByPublicId(
      db,
      channel.publicId,
    );
    expect(restoredChannel?.publicId).toBe(channel.publicId);
    const restoredMessage = await channelRepo.getMessageByPublicId(
      db,
      message!.publicId,
    );
    expect(restoredMessage?.deletedAt).toBeNull();
  });

  it("lists deleted channels and messages within the 30-day window only", async () => {
    const channel = await makeChannel("window");
    const fresh = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "recently deleted",
      userId: userA,
    });
    const stale = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "long gone",
      userId: userA,
    });
    await channelRepo.softDeleteMessage(db, fresh!.id);
    await db
      .update(schema.messages)
      .set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(sql`id = ${stale!.id}`);

    const deleted = await channelRepo.listDeletedMessages(db, workspaceId);
    const ids = deleted.map((m) => m.publicId);
    expect(ids).toContain(fresh!.publicId);
    expect(ids).not.toContain(stale!.publicId);
  });
});

describe("message full-text search (migration 0011)", () => {
  it("search_tsv matches message bodies", async () => {
    const channel = await makeChannel("search");
    await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "the quarterly deployment retrospective went sideways",
      userId: userA,
    });
    const result = (await db.execute(sql`
      SELECT m.public_id FROM message m
      WHERE m.search_tsv @@ plainto_tsquery('english', 'deployment retrospective')
    `)) as unknown;
    const rows = Array.isArray(result)
      ? (result as unknown[])
      : ((result as { rows: unknown[] }).rows ?? []);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("channel activity feed derivation", () => {
  it("surfaces @name mentions and replies in my threads, not my own posts", async () => {
    const channel = await makeChannel("activity");
    // Bob mentions Alice.
    const mention = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "hey @Alice can you look at this?",
      userId: userB,
    });
    // Alice starts a thread; Bob replies in it.
    const root = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "thread root by alice",
      userId: userA,
    });
    const reply = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "bob replying in alice's thread",
      userId: userB,
      parentMessageId: root!.id,
    });
    // Alice's own post — must not notify herself.
    const own = await channelRepo.addMessage(db, {
      channelId: channel.id,
      body: "@Alice talking to myself",
      userId: userA,
    });

    const feed = await channelRepo.listChannelActivityForUser(db, {
      workspaceId,
      userId: userA,
      userName: "Alice",
    });
    const ids = feed.map((f) => f.messagePublicId);
    expect(ids).toContain(mention!.publicId);
    expect(ids).toContain(reply!.publicId);
    expect(ids).not.toContain(own!.publicId);
    // Replies carry the thread root for deep-linking.
    const replyItem = feed.find((f) => f.messagePublicId === reply!.publicId);
    expect(replyItem?.threadRootPublicId).toBe(root!.publicId);
  });
});
