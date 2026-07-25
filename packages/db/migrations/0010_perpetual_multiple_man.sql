CREATE TABLE "message_reaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "gate_message_public_id" varchar(12);--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_reaction_unique_idx" ON "message_reaction" USING btree ("message_id","emoji","user_id");--> statement-breakpoint
CREATE INDEX "message_reaction_message_idx" ON "message_reaction" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "workflow_run_gate_message_idx" ON "workflow_run" USING btree ("gate_message_public_id");