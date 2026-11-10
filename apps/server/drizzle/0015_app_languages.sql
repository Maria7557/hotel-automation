ALTER TABLE "hotel_message_settings" ADD COLUMN "template_language" varchar(2) DEFAULT 'it' NOT NULL;--> statement-breakpoint
ALTER TABLE "hotel_message_settings" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_language" varchar(2);