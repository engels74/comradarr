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
ALTER TABLE "completion_snapshots" ADD CONSTRAINT "completion_snapshots_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completion_snapshots_connector_time_idx" ON "completion_snapshots" USING btree ("connector_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "completion_snapshots_connector_captured_idx" ON "completion_snapshots" USING btree ("connector_id","captured_at");