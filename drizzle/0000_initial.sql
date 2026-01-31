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
CREATE TABLE "api_key_rate_limit_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_key_rate_limit_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"api_key_id" integer NOT NULL,
	"requests_this_minute" integer DEFAULT 0 NOT NULL,
	"minute_window_start" timestamp with time zone,
	"last_request_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_rate_limit_state_api_key_id_unique" UNIQUE("api_key_id")
);
--> statement-breakpoint
CREATE TABLE "api_key_usage_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_key_usage_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"api_key_id" integer NOT NULL,
	"endpoint" varchar(500) NOT NULL,
	"method" varchar(10) NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"scope" varchar(20) DEFAULT 'read' NOT NULL,
	"key_prefix" varchar(8) NOT NULL,
	"key_hash" text NOT NULL,
	"rate_limit_per_minute" integer,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "application_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "application_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(10) NOT NULL,
	"module" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"correlation_id" varchar(36),
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "completion_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"episodes_monitored" integer DEFAULT 0 NOT NULL,
	"episodes_downloaded" integer DEFAULT 0 NOT NULL,
	"movies_monitored" integer DEFAULT 0 NOT NULL,
	"movies_downloaded" integer DEFAULT 0 NOT NULL,
	"completion_percentage" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connectors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"queue_paused" boolean DEFAULT false NOT NULL,
	"throttle_profile_id" integer,
	"last_sync" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "episodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"connector_id" integer NOT NULL,
	"arr_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" varchar(500),
	"air_date" timestamp with time zone,
	"monitored" boolean DEFAULT true NOT NULL,
	"has_file" boolean DEFAULT false NOT NULL,
	"quality" jsonb,
	"quality_cutoff_not_met" boolean DEFAULT false NOT NULL,
	"episode_file_id" integer,
	"last_search_time" timestamp with time zone,
	"first_downloaded_at" timestamp with time zone,
	"file_lost_at" timestamp with time zone,
	"file_loss_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"arr_id" integer NOT NULL,
	"tmdb_id" integer,
	"imdb_id" varchar(20),
	"title" varchar(500) NOT NULL,
	"year" integer,
	"monitored" boolean DEFAULT true NOT NULL,
	"has_file" boolean DEFAULT false NOT NULL,
	"quality" jsonb,
	"quality_cutoff_not_met" boolean DEFAULT false NOT NULL,
	"movie_file_id" integer,
	"last_search_time" timestamp with time zone,
	"first_downloaded_at" timestamp with time zone,
	"file_lost_at" timestamp with time zone,
	"file_loss_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"config" jsonb,
	"config_encrypted" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"enabled_events" jsonb,
	"batching_enabled" boolean DEFAULT false NOT NULL,
	"batching_window_seconds" integer DEFAULT 60 NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"quiet_hours_timezone" varchar(50) DEFAULT 'UTC',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_data" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"batch_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prowlarr_indexer_health" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prowlarr_indexer_health_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"prowlarr_instance_id" integer NOT NULL,
	"indexer_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"enabled" boolean NOT NULL,
	"is_rate_limited" boolean DEFAULT false NOT NULL,
	"rate_limit_expires_at" timestamp with time zone,
	"most_recent_failure" timestamp with time zone,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prowlarr_instances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prowlarr_instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"last_health_check" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_queue" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"search_registry_id" integer NOT NULL,
	"connector_id" integer NOT NULL,
	"batch_id" varchar(50),
	"priority" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "search_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"search_registry_id" integer,
	"connector_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"content_id" integer NOT NULL,
	"outcome" varchar(50) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_registry" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "search_registry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"content_id" integer NOT NULL,
	"search_type" varchar(20) NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_searched" timestamp with time zone,
	"next_eligible" timestamp with time zone,
	"failure_category" varchar(50),
	"season_pack_failed" boolean DEFAULT false NOT NULL,
	"backlog_tier" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"series_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"monitored" boolean DEFAULT true NOT NULL,
	"total_episodes" integer DEFAULT 0 NOT NULL,
	"downloaded_episodes" integer DEFAULT 0 NOT NULL,
	"next_airing" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"arr_id" integer NOT NULL,
	"tvdb_id" integer,
	"title" varchar(500) NOT NULL,
	"status" varchar(50),
	"monitored" boolean DEFAULT true NOT NULL,
	"quality_profile_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(500),
	"ip_address" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "sweep_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sweep_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer,
	"name" varchar(100) NOT NULL,
	"sweep_type" varchar(30) NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"throttle_profile_id" integer,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"last_sync" timestamp with time zone,
	"last_reconciliation" timestamp with time zone,
	"cursor" jsonb,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"reconnect_attempts" integer DEFAULT 0 NOT NULL,
	"next_reconnect_at" timestamp with time zone,
	"reconnect_started_at" timestamp with time zone,
	"last_reconnect_error" text,
	"reconnect_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_connector_id_unique" UNIQUE("connector_id")
);
--> statement-breakpoint
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
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" varchar(100) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(100),
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_login" timestamp with time zone,
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "analytics_daily_stats" ADD CONSTRAINT "analytics_daily_stats_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_hourly_stats" ADD CONSTRAINT "analytics_hourly_stats_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_rate_limit_state" ADD CONSTRAINT "api_key_rate_limit_state_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_usage_logs" ADD CONSTRAINT "api_key_usage_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_snapshots" ADD CONSTRAINT "completion_snapshots_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_throttle_profile_id_throttle_profiles_id_fk" FOREIGN KEY ("throttle_profile_id") REFERENCES "public"."throttle_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prowlarr_indexer_health" ADD CONSTRAINT "prowlarr_indexer_health_prowlarr_instance_id_prowlarr_instances_id_fk" FOREIGN KEY ("prowlarr_instance_id") REFERENCES "public"."prowlarr_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_queue" ADD CONSTRAINT "request_queue_search_registry_id_search_registry_id_fk" FOREIGN KEY ("search_registry_id") REFERENCES "public"."search_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_queue" ADD CONSTRAINT "request_queue_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_search_registry_id_search_registry_id_fk" FOREIGN KEY ("search_registry_id") REFERENCES "public"."search_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_registry" ADD CONSTRAINT "search_registry_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep_schedules" ADD CONSTRAINT "sweep_schedules_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep_schedules" ADD CONSTRAINT "sweep_schedules_throttle_profile_id_throttle_profiles_id_fk" FOREIGN KEY ("throttle_profile_id") REFERENCES "public"."throttle_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "throttle_state" ADD CONSTRAINT "throttle_state_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_stats_connector_date_idx" ON "analytics_daily_stats" USING btree ("connector_id","date_bucket");--> statement-breakpoint
CREATE INDEX "analytics_daily_stats_date_idx" ON "analytics_daily_stats" USING btree ("date_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_daily_stats_connector_idx" ON "analytics_daily_stats" USING btree ("connector_id","date_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_type_time_idx" ON "analytics_events" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_connector_time_idx" ON "analytics_events" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_hourly_stats_connector_hour_idx" ON "analytics_hourly_stats" USING btree ("connector_id","hour_bucket");--> statement-breakpoint
CREATE INDEX "analytics_hourly_stats_time_idx" ON "analytics_hourly_stats" USING btree ("hour_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_hourly_stats_connector_idx" ON "analytics_hourly_stats" USING btree ("connector_id","hour_bucket" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_key_rate_limit_state_api_key_idx" ON "api_key_rate_limit_state" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_key_usage_logs_key_idx" ON "api_key_usage_logs" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_key_usage_logs_created_idx" ON "api_key_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "application_logs_level_time_idx" ON "application_logs" USING btree ("level","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_logs_module_time_idx" ON "application_logs" USING btree ("module","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_logs_correlation_idx" ON "application_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "application_logs_created_idx" ON "application_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "completion_snapshots_connector_time_idx" ON "completion_snapshots" USING btree ("connector_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "completion_snapshots_connector_captured_idx" ON "completion_snapshots" USING btree ("connector_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_connector_arr_idx" ON "episodes" USING btree ("connector_id","arr_id");--> statement-breakpoint
CREATE INDEX "episodes_gap_idx" ON "episodes" USING btree ("connector_id","has_file");--> statement-breakpoint
CREATE INDEX "episodes_upgrade_idx" ON "episodes" USING btree ("connector_id","quality_cutoff_not_met");--> statement-breakpoint
CREATE UNIQUE INDEX "movies_connector_arr_idx" ON "movies" USING btree ("connector_id","arr_id");--> statement-breakpoint
CREATE INDEX "movies_gap_idx" ON "movies" USING btree ("connector_id","has_file");--> statement-breakpoint
CREATE INDEX "movies_upgrade_idx" ON "movies" USING btree ("connector_id","quality_cutoff_not_met");--> statement-breakpoint
CREATE INDEX "notification_channels_type_enabled_idx" ON "notification_channels" USING btree ("type","enabled");--> statement-breakpoint
CREATE INDEX "notification_history_channel_idx" ON "notification_history" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_history_status_idx" ON "notification_history" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_history_batch_idx" ON "notification_history" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prowlarr_indexer_health_instance_indexer_idx" ON "prowlarr_indexer_health" USING btree ("prowlarr_instance_id","indexer_id");--> statement-breakpoint
CREATE INDEX "prowlarr_indexer_health_rate_limited_idx" ON "prowlarr_indexer_health" USING btree ("prowlarr_instance_id","is_rate_limited");--> statement-breakpoint
CREATE INDEX "request_queue_priority_idx" ON "request_queue" USING btree ("connector_id","priority" DESC NULLS LAST,"scheduled_at");--> statement-breakpoint
CREATE INDEX "search_history_connector_idx" ON "search_history" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_history_content_idx" ON "search_history" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_registry_content_idx" ON "search_registry" USING btree ("connector_id","content_type","content_id");--> statement-breakpoint
CREATE INDEX "search_registry_state_idx" ON "search_registry" USING btree ("connector_id","state");--> statement-breakpoint
CREATE INDEX "search_registry_eligible_idx" ON "search_registry" USING btree ("state","next_eligible");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_series_number_idx" ON "seasons" USING btree ("series_id","season_number");--> statement-breakpoint
CREATE UNIQUE INDEX "series_connector_arr_idx" ON "series" USING btree ("connector_id","arr_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sweep_schedules_connector_idx" ON "sweep_schedules" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "sweep_schedules_enabled_idx" ON "sweep_schedules" USING btree ("enabled");