CREATE TABLE "channel_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" text,
	"agent_identity_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"topic" varchar(250),
	"board_id" integer,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"channel_id" integer NOT NULL,
	"body" text NOT NULL,
	"parent_message_id" integer,
	"created_by" text,
	"agent_identity_id" integer,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_parent_message_id_message_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_agent_identity_id_agent_identity_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_member_public_id_idx" ON "channel_member" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "channel_member_channel_idx" ON "channel_member" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_public_id_idx" ON "channel" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "channel_workspace_idx" ON "channel" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_public_id_idx" ON "message" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "message_channel_idx" ON "message" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "message_parent_idx" ON "message" USING btree ("parent_message_id");