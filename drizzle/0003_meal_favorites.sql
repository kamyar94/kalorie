ALTER TABLE "meals" ADD COLUMN "favorite_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "favorite_used_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "meals_user_favorite_idx" ON "meals" USING btree ("user_id","favorite_at") WHERE "meals"."favorite_at" is not null and "meals"."deleted_at" is null;