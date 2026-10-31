CREATE TABLE "hotel_message_settings" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"email_subject_template" varchar(160) NOT NULL,
	"email_body_template" text NOT NULL,
	"whatsapp_body_template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hotel_message_settings" ADD CONSTRAINT "hotel_message_settings_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;