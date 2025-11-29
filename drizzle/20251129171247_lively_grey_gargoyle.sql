CREATE TABLE "connectors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connectors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_status" varchar(20) DEFAULT 'unknown' NOT NULL,
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
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"last_sync" timestamp with time zone,
	"last_reconciliation" timestamp with time zone,
	"cursor" jsonb,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_connector_id_unique" UNIQUE("connector_id")
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_queue" ADD CONSTRAINT "request_queue_search_registry_id_search_registry_id_fk" FOREIGN KEY ("search_registry_id") REFERENCES "public"."search_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_queue" ADD CONSTRAINT "request_queue_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_search_registry_id_search_registry_id_fk" FOREIGN KEY ("search_registry_id") REFERENCES "public"."search_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_registry" ADD CONSTRAINT "search_registry_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_connector_arr_idx" ON "episodes" USING btree ("connector_id","arr_id");--> statement-breakpoint
CREATE INDEX "episodes_gap_idx" ON "episodes" USING btree ("connector_id","has_file");--> statement-breakpoint
CREATE INDEX "episodes_upgrade_idx" ON "episodes" USING btree ("connector_id","quality_cutoff_not_met");--> statement-breakpoint
CREATE UNIQUE INDEX "movies_connector_arr_idx" ON "movies" USING btree ("connector_id","arr_id");--> statement-breakpoint
CREATE INDEX "movies_gap_idx" ON "movies" USING btree ("connector_id","has_file");--> statement-breakpoint
CREATE INDEX "movies_upgrade_idx" ON "movies" USING btree ("connector_id","quality_cutoff_not_met");--> statement-breakpoint
CREATE INDEX "request_queue_priority_idx" ON "request_queue" USING btree ("connector_id","priority" DESC NULLS LAST,"scheduled_at");--> statement-breakpoint
CREATE INDEX "search_history_connector_idx" ON "search_history" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_history_content_idx" ON "search_history" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_registry_content_idx" ON "search_registry" USING btree ("connector_id","content_type","content_id");--> statement-breakpoint
CREATE INDEX "search_registry_state_idx" ON "search_registry" USING btree ("connector_id","state");--> statement-breakpoint
CREATE INDEX "search_registry_eligible_idx" ON "search_registry" USING btree ("state","next_eligible");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_series_number_idx" ON "seasons" USING btree ("series_id","season_number");--> statement-breakpoint
CREATE UNIQUE INDEX "series_connector_arr_idx" ON "series" USING btree ("connector_id","arr_id");