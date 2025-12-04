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
ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_channels_type_enabled_idx" ON "notification_channels" USING btree ("type","enabled");--> statement-breakpoint
CREATE INDEX "notification_history_channel_idx" ON "notification_history" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_history_status_idx" ON "notification_history" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_history_batch_idx" ON "notification_history" USING btree ("batch_id");