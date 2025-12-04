CREATE TABLE "analytics_daily_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_daily_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"date_bucket" timestamp with time zone NOT NULL,
	"gaps_discovered" integer DEFAULT 0 NOT NULL,
	"upgrades_discovered" integer DEFAULT 0 NOT NULL,
	"searches_dispatched" integer DEFAULT 0 NOT NULL,
	"searches_successful" integer DEFAULT 0 NOT NULL,
	"searches_failed" integer DEFAULT 0 NOT NULL,
	"searches_no_results" integer DEFAULT 0 NOT NULL,
	"avg_queue_depth" integer DEFAULT 0 NOT NULL,
	"peak_queue_depth" integer DEFAULT 0 NOT NULL,
	"avg_response_time_ms" integer,
	"max_response_time_ms" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"completion_percentage" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer,
	"event_type" varchar(50) NOT NULL,
	"event_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_hourly_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_hourly_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"gaps_discovered" integer DEFAULT 0 NOT NULL,
	"upgrades_discovered" integer DEFAULT 0 NOT NULL,
	"searches_dispatched" integer DEFAULT 0 NOT NULL,
	"searches_successful" integer DEFAULT 0 NOT NULL,
	"searches_failed" integer DEFAULT 0 NOT NULL,
	"searches_no_results" integer DEFAULT 0 NOT NULL,
	"avg_queue_depth" integer DEFAULT 0 NOT NULL,
	"peak_queue_depth" integer DEFAULT 0 NOT NULL,
	"avg_response_time_ms" integer,
	"max_response_time_ms" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily_stats" ADD CONSTRAINT "analytics_daily_stats_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_hourly_stats" ADD CONSTRAINT "analytics_hourly_stats_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_stats_connector_date_idx" ON "analytics_daily_stats" USING btree ("connector_id","date_bucket");--> statement-breakpoint
CREATE INDEX "analytics_daily_stats_date_idx" ON "analytics_daily_stats" USING btree ("date_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_daily_stats_connector_idx" ON "analytics_daily_stats" USING btree ("connector_id","date_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_type_time_idx" ON "analytics_events" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_connector_time_idx" ON "analytics_events" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_hourly_stats_connector_hour_idx" ON "analytics_hourly_stats" USING btree ("connector_id","hour_bucket");--> statement-breakpoint
CREATE INDEX "analytics_hourly_stats_time_idx" ON "analytics_hourly_stats" USING btree ("hour_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_hourly_stats_connector_idx" ON "analytics_hourly_stats" USING btree ("connector_id","hour_bucket" DESC NULLS LAST);