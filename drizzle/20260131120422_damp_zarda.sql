ALTER TABLE "episodes" ADD COLUMN "first_downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "file_lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "file_loss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "first_downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "file_lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "file_loss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: Mark items that currently have files as having been downloaded
UPDATE "episodes" SET "first_downloaded_at" = "created_at" WHERE "has_file" = true;--> statement-breakpoint
UPDATE "movies" SET "first_downloaded_at" = "created_at" WHERE "has_file" = true;
