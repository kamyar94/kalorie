CREATE TABLE "body_photo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"tz" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pose" text NOT NULL,
	"original_path" text NOT NULL,
	"view_path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"facing" text,
	"source" text DEFAULT 'camera' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_photo_sessions" ADD CONSTRAINT "body_photo_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_photos" ADD CONSTRAINT "body_photos_session_id_body_photo_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."body_photo_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_photos" ADD CONSTRAINT "body_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_photo_sessions_user_day_idx" ON "body_photo_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "body_photos_session_pose_idx" ON "body_photos" USING btree ("session_id","pose");--> statement-breakpoint
CREATE INDEX "body_photos_user_idx" ON "body_photos" USING btree ("user_id");