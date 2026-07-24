ALTER TABLE "agent_job" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "patch" text;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "patch_summary" text;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "patch_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "patch_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "patch_apply_error" text;