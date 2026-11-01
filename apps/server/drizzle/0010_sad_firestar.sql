CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push_all_requests" boolean DEFAULT false NOT NULL,
	"email_incoming_requests" boolean DEFAULT false NOT NULL,
	"email_address" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"device_name" varchar(120),
	"active" boolean DEFAULT true NOT NULL,
	"last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_unique" ON "push_devices" USING btree ("expo_push_token");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");