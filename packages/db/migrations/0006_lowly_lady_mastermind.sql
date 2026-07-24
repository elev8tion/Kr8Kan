ALTER TABLE "agent_job" ADD COLUMN "events" jsonb;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "retry_of_public_id" varchar(32);