CREATE TABLE "heart_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"tz" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"bpm" real NOT NULL,
	"max_bpm" real,
	"source" text DEFAULT 'health_connect' NOT NULL,
	"source_app" text,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sleep_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"local_date" date NOT NULL,
	"duration_min" real NOT NULL,
	"stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text,
	"source" text DEFAULT 'health_connect' NOT NULL,
	"source_app" text,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heart_rates" ADD CONSTRAINT "heart_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_sessions" ADD CONSTRAINT "sleep_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heart_rates_user_day_idx" ON "heart_rates" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "heart_rates_user_external_idx" ON "heart_rates" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "sleep_sessions_user_day_idx" ON "sleep_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_sessions_user_external_idx" ON "sleep_sessions" USING btree ("user_id","source","external_id");