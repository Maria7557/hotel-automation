ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_subject" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_subject" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_subject_unique" ON "users" USING btree ("google_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_subject_unique" ON "users" USING btree ("apple_subject");