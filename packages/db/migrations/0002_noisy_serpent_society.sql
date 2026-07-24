CREATE TYPE "public"."agent_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_job" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"workspace_id" integer NOT NULL,
	"board_public_id" varchar(12),
	"card_public_id" varchar(12),
	"worker" varchar(64) NOT NULL,
	"status" "agent_job_status" DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"prompt" text,
	"result_raw" text,
	"result_parsed" jsonb,
	"parse_error" text,
	"error" text,
	"project_path" text,
	"pi_model" varchar(120),
	"tools_used" boolean DEFAULT false NOT NULL,
	"prompt_version" integer,
	"progress" text,
	"verify_status" varchar(16),
	"verify_log" text,
	"applied_actions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "board" ADD COLUMN "agent_verify_command" text;--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_public_id_idx" ON "agent_job" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "agent_job_workspace_idx" ON "agent_job" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_job_status_idx" ON "agent_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_job_created_by_idx" ON "agent_job" USING btree ("created_by");