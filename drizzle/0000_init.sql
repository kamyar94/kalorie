CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "ai_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_last_four" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"user_id" uuid NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"reasoning" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_user_id_task_pk" PRIMARY KEY("user_id","task")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"meal_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dish_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"dish_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"grams" real NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "dri_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"sex" text NOT NULL,
	"age_min" integer NOT NULL,
	"age_max" integer NOT NULL,
	"life_stage" text DEFAULT '' NOT NULL,
	"nutrient_code" text NOT NULL,
	"rda" real,
	"ai" real,
	"ul" real,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	"display_name" text NOT NULL,
	"food_id" uuid,
	"typical_grams" real,
	"count" integer DEFAULT 1 NOT NULL,
	"snapshot" jsonb,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_portions" (
	"id" serial PRIMARY KEY NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_fa" text,
	"amount" real DEFAULT 1 NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"grams" real NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"owner_id" uuid,
	"kind" text DEFAULT 'food' NOT NULL,
	"name_en" text NOT NULL,
	"name_fa" text,
	"synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" text,
	"brand" text,
	"barcode" text,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"density_g_per_ml" real,
	"serving_grams" real,
	"source_note" text,
	"data_release" text,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("search_text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"encrypted_credential" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"status_message" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"local_name" text,
	"kind" text DEFAULT 'dish' NOT NULL,
	"preparation" text,
	"food_id" uuid,
	"grams" real DEFAULT 0 NOT NULL,
	"ml" real,
	"portion_text" text,
	"count" real DEFAULT 1 NOT NULL,
	"model_grams" real,
	"grams_low" real,
	"grams_high" real,
	"confidence" real,
	"estimate" jsonb,
	"search_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"photo_indexes" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"nutrients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nutrient_source" text DEFAULT 'ai_estimate' NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"original_path" text NOT NULL,
	"analysis_path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text,
	"eaten_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"local_date" date NOT NULL,
	"slot" text NOT NULL,
	"title" text,
	"note" text,
	"status" text DEFAULT 'analysing' NOT NULL,
	"source" text DEFAULT 'photo' NOT NULL,
	"analysis" jsonb,
	"analysis_count" integer DEFAULT 0 NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nutrients" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"group" text NOT NULL,
	"display_order" integer NOT NULL,
	"fdc_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"shown" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reset_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_targets" (
	"user_id" uuid NOT NULL,
	"nutrient_code" text NOT NULL,
	"target" real,
	"upper" real,
	"kind" text DEFAULT 'min' NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_targets_user_id_nutrient_code_pk" PRIMARY KEY("user_id","nutrient_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"sex" text,
	"birth_year" integer,
	"height_cm" real,
	"weight_kg" real,
	"activity_level" text,
	"goal" text,
	"goal_rate_kg_per_week" real,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"meal_windows" jsonb DEFAULT '{"breakfast":["04:00","10:30"],"lunch":["11:00","15:00"],"dinner":["17:00","21:30"]}'::jsonb NOT NULL,
	"cuisines" text[] DEFAULT '{}'::text[] NOT NULL,
	"notifications" jsonb DEFAULT '{"analysisReady":false,"questions":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_lower" CHECK ("users"."username" = lower("users"."username"))
);
--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_components" ADD CONSTRAINT "dish_components_dish_id_foods_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_components" ADD CONSTRAINT "dish_components_component_id_foods_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dri_targets" ADD CONSTRAINT "dri_targets_nutrient_code_nutrients_code_fk" FOREIGN KEY ("nutrient_code") REFERENCES "public"."nutrients"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_memory" ADD CONSTRAINT "food_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_memory" ADD CONSTRAINT "food_memory_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_portions" ADD CONSTRAINT "food_portions_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reset_codes" ADD CONSTRAINT "reset_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reset_codes" ADD CONSTRAINT "reset_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_targets" ADD CONSTRAINT "user_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_keys_user_provider_idx" ON "ai_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "ai_usage_user_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "dish_components_dish_idx" ON "dish_components" USING btree ("dish_id","position");--> statement-breakpoint
CREATE INDEX "dish_components_component_idx" ON "dish_components" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dri_targets_band_idx" ON "dri_targets" USING btree ("sex","age_min","age_max","life_stage","nutrient_code");--> statement-breakpoint
CREATE UNIQUE INDEX "food_memory_user_name_idx" ON "food_memory" USING btree ("user_id","name_key");--> statement-breakpoint
CREATE INDEX "food_memory_user_used_idx" ON "food_memory" USING btree ("user_id","last_used_at");--> statement-breakpoint
CREATE INDEX "food_portions_food_idx" ON "food_portions" USING btree ("food_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_idx" ON "foods" USING btree ("source","source_id") WHERE "foods"."source_id" is not null and "foods"."owner_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "foods_owner_source_idx" ON "foods" USING btree ("owner_id","source","source_id") WHERE "foods"."source_id" is not null and "foods"."owner_id" is not null;--> statement-breakpoint
CREATE INDEX "foods_owner_idx" ON "foods" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "foods_search_trgm_idx" ON "foods" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "foods_search_vector_idx" ON "foods" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_kind_idx" ON "integrations" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_code_idx" ON "invites" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("run_after","id") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("locked_at") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("kind","dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id","position");--> statement-breakpoint
CREATE INDEX "meal_items_user_idx" ON "meal_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meal_items_food_idx" ON "meal_items" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_photos_meal_position_idx" ON "meal_photos" USING btree ("meal_id","position");--> statement-breakpoint
CREATE INDEX "meal_photos_user_idx" ON "meal_photos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meals_user_day_idx" ON "meals" USING btree ("user_id","local_date","eaten_at") WHERE "meals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "meals_user_eaten_idx" ON "meals" USING btree ("user_id","eaten_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_user_client_idx" ON "meals" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limits_reset_idx" ON "rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reset_codes_code_idx" ON "reset_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");