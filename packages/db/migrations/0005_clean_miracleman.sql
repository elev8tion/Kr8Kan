CREATE TABLE "card_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "card_template" ADD CONSTRAINT "card_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_template" ADD CONSTRAINT "card_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_template_public_id_idx" ON "card_template" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_template_name_idx" ON "card_template" USING btree ("workspace_id","name");