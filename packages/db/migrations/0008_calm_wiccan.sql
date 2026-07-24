ALTER TABLE "agent_job" ADD COLUMN "context_ids" jsonb;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "eval_status" varchar(24);--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "eval_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "prompt_flags" jsonb;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;