CREATE TABLE "client_request_sync" (
	"inquiry_id" uuid PRIMARY KEY NOT NULL,
	"hotel_id" uuid NOT NULL,
	"client_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_worker_hotels" (
	"hotel_id" uuid PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(320),
	"phone" varchar(50),
	"normalized_email" varchar(320),
	"normalized_phone" varchar(16),
	"locale" varchar(16) NOT NULL,
	"source" varchar(16) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"first_inquiry_at" timestamp with time zone,
	"last_inquiry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "client_sync_pending" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_request_sync" ADD CONSTRAINT "client_request_sync_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_request_sync" ADD CONSTRAINT "client_request_sync_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_request_sync" ADD CONSTRAINT "client_request_sync_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_worker_hotels" ADD CONSTRAINT "client_worker_hotels_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_request_sync_client_idx" ON "client_request_sync" USING btree ("hotel_id","client_id","inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_hotel_email_unique" ON "clients" USING btree ("hotel_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_hotel_phone_unique" ON "clients" USING btree ("hotel_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "clients_hotel_created_idx" ON "clients" USING btree ("hotel_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inquiries_client_pending_idx" ON "inquiries" USING btree ("hotel_id","created_at","id") WHERE "inquiries"."client_sync_pending" = true;