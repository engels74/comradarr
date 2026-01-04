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
ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "api_key_rate_limit_state" ADD CONSTRAINT "api_key_rate_limit_state_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_rate_limit_state_api_key_idx" ON "api_key_rate_limit_state" USING btree ("api_key_id");
