CREATE TYPE "public"."agent_identity_kind" AS ENUM('stock', 'custom');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('running', 'waiting_gate', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_identity" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"kind" "agent_identity_kind" DEFAULT 'stock' NOT NULL,
	"worker_name" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"avatar" varchar(16) DEFAULT '🤖' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_public_id" varchar(32),
	"actor_user_id" text,
	"actor_agent_id" integer,
	"payload" jsonb,
	"prev_hash" varchar(64) NOT NULL,
	"hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"comment_id" integer NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_worker" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text,
	"avatar" varchar(16) DEFAULT '✨' NOT NULL,
	"system_prompt" text NOT NULL,
	"needs" varchar(8) DEFAULT 'either' NOT NULL,
	"output_mode" varchar(16) DEFAULT 'freeform' NOT NULL,
	"schema_worker" varchar(64),
	"prompt_version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workflow_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"status" "workflow_run_status" DEFAULT 'running' NOT NULL,
	"trigger_event" jsonb,
	"step_results" jsonb,
	"current_step" integer DEFAULT 0 NOT NULL,
	"card_public_id" varchar(12),
	"gate_comment_public_id" varchar(12),
	"gate_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"board_public_id" varchar(12),
	"name" varchar(160) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" text,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "agent_identity_id" integer;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "schema_worker" varchar(64);--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "agent_identity_id" integer;--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "source_comment_public_id" varchar(12);--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "agent_identity_id" integer;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identity" ADD CONSTRAINT "agent_identity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_agent_id_agent_identity_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_worker" ADD CONSTRAINT "custom_worker_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_worker" ADD CONSTRAINT "custom_worker_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_public_id_idx" ON "agent_identity" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_worker_idx" ON "agent_identity" USING btree ("workspace_id","worker_name");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq_idx" ON "audit_log" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_idx" ON "audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reaction_unique_idx" ON "comment_reaction" USING btree ("comment_id","emoji","user_id");--> statement-breakpoint
CREATE INDEX "comment_reaction_comment_idx" ON "comment_reaction" USING btree ("comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_worker_public_id_idx" ON "custom_worker" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_worker_name_idx" ON "custom_worker" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_public_id_idx" ON "workflow_run" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "workflow_run_workflow_idx" ON "workflow_run" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_run_status_idx" ON "workflow_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_run_gate_comment_idx" ON "workflow_run" USING btree ("gate_comment_public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_public_id_idx" ON "workflow" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "workflow_workspace_idx" ON "workflow" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("title",'') || ' ' || coalesce("description",''))) STORED;--> statement-breakpoint
CREATE INDEX "card_search_idx" ON "card" USING gin ("search_tsv");--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("comment",''))) STORED;--> statement-breakpoint
CREATE INDEX "comment_search_idx" ON "comment" USING gin ("search_tsv");--> statement-breakpoint
ALTER TABLE "agent_job" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("result_raw",''))) STORED;--> statement-breakpoint
CREATE INDEX "agent_job_search_idx" ON "agent_job" USING gin ("search_tsv");
