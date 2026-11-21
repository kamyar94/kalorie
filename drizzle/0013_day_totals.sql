CREATE TABLE "activity_day_totals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source" text DEFAULT 'health_connect' NOT NULL,
	"tz" text NOT NULL,
	"steps" integer,
	"steps_app" text,
	"active_minutes" integer,
	"active_method" text,
	"active_app" text,
	"active_kcal" real,
	"kcal_app" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_connect_updates" ADD COLUMN "day_totals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_day_totals" ADD CONSTRAINT "activity_day_totals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_day_totals" ADD CONSTRAINT "activity_day_totals_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_day_totals_user_day_idx" ON "activity_day_totals" USING btree ("user_id","local_date","source");