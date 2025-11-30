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
