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
CREATE INDEX "application_logs_level_time_idx" ON "application_logs" USING btree ("level","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_logs_module_time_idx" ON "application_logs" USING btree ("module","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_logs_correlation_idx" ON "application_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "application_logs_created_idx" ON "application_logs" USING btree ("created_at");