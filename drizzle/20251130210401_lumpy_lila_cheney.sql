CREATE TABLE "throttle_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "throttle_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(50) NOT NULL,
	"description" text,
	"requests_per_minute" integer NOT NULL,
	"daily_budget" integer,
	"batch_size" integer NOT NULL,
	"batch_cooldown_seconds" integer NOT NULL,
	"rate_limit_pause_seconds" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "throttle_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "throttle_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "throttle_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"requests_this_minute" integer DEFAULT 0 NOT NULL,
	"requests_today" integer DEFAULT 0 NOT NULL,
	"minute_window_start" timestamp with time zone,
	"day_window_start" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"pause_reason" varchar(50),
	"last_request_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "throttle_state_connector_id_unique" UNIQUE("connector_id")
);
--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "throttle_profile_id" integer;--> statement-breakpoint
ALTER TABLE "throttle_state" ADD CONSTRAINT "throttle_state_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_throttle_profile_id_throttle_profiles_id_fk" FOREIGN KEY ("throttle_profile_id") REFERENCES "public"."throttle_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Seed throttle profile presets (Requirements 7.1, 7.5)
INSERT INTO "throttle_profiles" ("name", "description", "requests_per_minute", "daily_budget", "batch_size", "batch_cooldown_seconds", "rate_limit_pause_seconds", "is_default")
VALUES
  ('Conservative', 'Low rate limits for shared/public indexers', 2, 200, 5, 120, 600, false),
  ('Moderate', 'Balanced rate limits for typical usage', 5, 500, 10, 60, 300, true),
  ('Aggressive', 'High rate limits for private indexers', 15, NULL, 10, 30, 120, false);