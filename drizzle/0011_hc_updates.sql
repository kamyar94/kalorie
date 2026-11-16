CREATE TABLE "health_connect_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tz" text NOT NULL,
	"app_version" text,
	"first_read_days" integer,
	"step_days" integer DEFAULT 0 NOT NULL,
	"step_days_zero" integer DEFAULT 0 NOT NULL,
	"steps_today" integer,
	"workouts" integer DEFAULT 0 NOT NULL,
	"resting_days" integer DEFAULT 0 NOT NULL,
	"sleep_sessions" integer DEFAULT 0 NOT NULL,
	"body_records" integer DEFAULT 0 NOT NULL,
	"weigh_ins" integer DEFAULT 0 NOT NULL,
	"height" boolean DEFAULT false NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"written" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"empty" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_connect_updates" ADD CONSTRAINT "health_connect_updates_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_connect_updates" ADD CONSTRAINT "health_connect_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_connect_updates_device_idx" ON "health_connect_updates" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "health_connect_updates_user_idx" ON "health_connect_updates" USING btree ("user_id","received_at");