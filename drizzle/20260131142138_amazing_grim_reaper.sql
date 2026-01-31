CREATE TABLE "pending_commands" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pending_commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connector_id" integer NOT NULL,
	"search_registry_id" integer NOT NULL,
	"command_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"content_id" integer NOT NULL,
	"search_type" varchar(20) NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"command_status" varchar(20),
	"file_acquired" boolean
);
--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_search_registry_id_search_registry_id_fk" FOREIGN KEY ("search_registry_id") REFERENCES "public"."search_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_commands_connector_idx" ON "pending_commands" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "pending_commands_content_idx" ON "pending_commands" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "pending_commands_status_idx" ON "pending_commands" USING btree ("command_status","completed_at");