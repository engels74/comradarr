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
ALTER TABLE "sweep_schedules" ADD CONSTRAINT "sweep_schedules_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweep_schedules" ADD CONSTRAINT "sweep_schedules_throttle_profile_id_throttle_profiles_id_fk" FOREIGN KEY ("throttle_profile_id") REFERENCES "public"."throttle_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sweep_schedules_connector_idx" ON "sweep_schedules" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "sweep_schedules_enabled_idx" ON "sweep_schedules" USING btree ("enabled");
