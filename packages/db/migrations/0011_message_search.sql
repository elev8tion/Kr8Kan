-- Message full-text search: same generated-tsvector pattern as card /
-- comment / agent_job (0003). Messages join the global search surface.
ALTER TABLE "message" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("body",''))) STORED;--> statement-breakpoint
CREATE INDEX "message_search_idx" ON "message" USING gin ("search_tsv");
