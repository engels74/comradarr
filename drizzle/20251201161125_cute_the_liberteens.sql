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
ALTER TABLE "prowlarr_indexer_health" ADD CONSTRAINT "prowlarr_indexer_health_prowlarr_instance_id_prowlarr_instances_id_fk" FOREIGN KEY ("prowlarr_instance_id") REFERENCES "public"."prowlarr_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prowlarr_indexer_health_instance_indexer_idx" ON "prowlarr_indexer_health" USING btree ("prowlarr_instance_id","indexer_id");--> statement-breakpoint
CREATE INDEX "prowlarr_indexer_health_rate_limited_idx" ON "prowlarr_indexer_health" USING btree ("prowlarr_instance_id","is_rate_limited");
