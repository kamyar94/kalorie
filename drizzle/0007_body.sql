CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"unit" text NOT NULL,
	"value" real NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"local_date" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_app" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"allergies" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"use_in_analysis" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_measurements_user_code_idx" ON "body_measurements" USING btree ("user_id","code","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_user_external_idx" ON "body_measurements" USING btree ("user_id","source","external_id");