CREATE TABLE "medicine_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"medicine_id" uuid,
	"name" text NOT NULL,
	"strength" text,
	"form" text,
	"amount" real NOT NULL,
	"unit" text,
	"taken_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"local_date" date NOT NULL,
	"scan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicine_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"original_path" text NOT NULL,
	"analysis_path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"reading" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" text,
	"form" text,
	"usual_amount" real DEFAULT 1 NOT NULL,
	"unit" text,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medicine_logs" ADD CONSTRAINT "medicine_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_logs" ADD CONSTRAINT "medicine_logs_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_logs" ADD CONSTRAINT "medicine_logs_scan_id_medicine_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."medicine_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_scans" ADD CONSTRAINT "medicine_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medicine_logs_user_day_idx" ON "medicine_logs" USING btree ("user_id","local_date","taken_at");--> statement-breakpoint
CREATE INDEX "medicine_logs_medicine_idx" ON "medicine_logs" USING btree ("medicine_id");--> statement-breakpoint
CREATE INDEX "medicine_logs_scan_idx" ON "medicine_logs" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "medicine_scans_user_idx" ON "medicine_scans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "medicines_user_idx" ON "medicines" USING btree ("user_id","archived");