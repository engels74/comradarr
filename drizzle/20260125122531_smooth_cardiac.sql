ALTER TABLE "sync_state" ADD COLUMN "reconnect_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "next_reconnect_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "reconnect_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_reconnect_error" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "reconnect_paused" boolean DEFAULT false NOT NULL;