CREATE TABLE "board_note" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" varchar(12) NOT NULL,
	"board_id" integer NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_by_agent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_updated_by_agent_id_agent_identity_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agent_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_note_public_id_idx" ON "board_note" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_note_board_idx" ON "board_note" USING btree ("board_id");