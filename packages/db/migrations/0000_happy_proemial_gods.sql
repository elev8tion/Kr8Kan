CREATE TYPE "public"."board_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('admin', 'member', 'guest');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"permissions" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"card_id" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"created_by" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"card_id" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"key" text NOT NULL,
	"content_type" varchar(127),
	"size" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "board" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"visibility" "board_visibility" DEFAULT 'private' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "card_label" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"list_id" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"index" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checklist_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"checklist_id" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"card_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"card_id" integer NOT NULL,
	"comment" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"board_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"colour_code" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "list" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"board_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_invite" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"code" varchar(24) NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" varchar(254),
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"plan" varchar(24) DEFAULT 'selfhost' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_label" ADD CONSTRAINT "card_label_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_label" ADD CONSTRAINT "card_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_member" ADD CONSTRAINT "card_member_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_member" ADD CONSTRAINT "card_member_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_checklist_id_checklist_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invite" ADD CONSTRAINT "workspace_invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invite" ADD CONSTRAINT "workspace_invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_activity_card_idx" ON "card_activity" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_public_id_idx" ON "attachment" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "attachment_card_idx" ON "attachment" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_public_id_idx" ON "board" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "board_workspace_idx" ON "board" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_label_unique_idx" ON "card_label" USING btree ("card_id","label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_member_unique_idx" ON "card_member" USING btree ("card_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_public_id_idx" ON "card" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "card_list_idx" ON "card" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_item_public_id_idx" ON "checklist_item" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "checklist_item_checklist_idx" ON "checklist_item" USING btree ("checklist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_public_id_idx" ON "checklist" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "checklist_card_idx" ON "checklist" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_public_id_idx" ON "comment" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "comment_card_idx" ON "comment" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_public_id_idx" ON "label" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "label_board_idx" ON "label" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "list_public_id_idx" ON "list" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "list_board_idx" ON "list" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_public_id_idx" ON "webhook" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "webhook_workspace_idx" ON "webhook" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invite_code_idx" ON "workspace_invite" USING btree ("code");--> statement-breakpoint
CREATE INDEX "workspace_invite_workspace_idx" ON "workspace_invite" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_public_id_idx" ON "workspace_member" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "workspace_member_workspace_idx" ON "workspace_member" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_public_id_idx" ON "workspace" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_idx" ON "workspace" USING btree ("slug");