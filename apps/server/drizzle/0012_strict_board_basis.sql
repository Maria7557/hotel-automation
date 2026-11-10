ALTER TABLE "rate_periods" RENAME COLUMN "breakfast_adult_cents" TO "board_adult_cents";--> statement-breakpoint
ALTER TABLE "rate_periods" RENAME COLUMN "breakfast_child_cents" TO "board_child_cents";--> statement-breakpoint
ALTER TABLE "rate_periods" ALTER COLUMN "meal_plan" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "meal_plan" varchar(2);--> statement-breakpoint
-- Keep historical room-only rates for audit, but remove them from the sellable catalog.
UPDATE "rate_periods" SET "active" = false, "deleted_at" = COALESCE("deleted_at", now()), "updated_at" = now()
WHERE "meal_plan" NOT IN ('BB', 'HB', 'FB', 'breakfast');
--> statement-breakpoint
UPDATE "rate_periods" SET "meal_plan" = 'BB' WHERE "meal_plan" = 'breakfast';
--> statement-breakpoint
-- Infer old requests only when the selected offer, or every offered option, has one board.
WITH historical_boards AS (
  SELECT i.id,
    CASE WHEN o.selected_option_index IS NOT NULL
      THEN CASE o.snapshot->'options'->o.selected_option_index->>'mealPlan'
        WHEN 'breakfast' THEN 'BB'
        WHEN 'BB' THEN 'BB' WHEN 'HB' THEN 'HB' WHEN 'FB' THEN 'FB' END
      WHEN count(DISTINCT option.value->>'mealPlan') = 1
      THEN CASE min(option.value->>'mealPlan')
        WHEN 'breakfast' THEN 'BB'
        WHEN 'BB' THEN 'BB' WHEN 'HB' THEN 'HB' WHEN 'FB' THEN 'FB' END
    END AS board
  FROM inquiries i
  JOIN offer_versions o ON o.id = i.current_offer_id
  CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'options') AS option(value)
  GROUP BY i.id, o.id
)
UPDATE inquiries i SET meal_plan = h.board FROM historical_boards h WHERE i.id = h.id AND h.board IS NOT NULL;
--> statement-breakpoint
UPDATE inquiries SET attention_reason = 'manual_review' WHERE meal_plan IS NULL AND closed_at IS NULL;
--> statement-breakpoint
-- Do not send or accept a historical quote with an unresolved board.
UPDATE offer_versions o SET state = 'revoked', revoked_at = now()
FROM inquiries i WHERE o.inquiry_id = i.id AND i.meal_plan IS NULL AND o.state = 'active';
--> statement-breakpoint
UPDATE deliveries d SET state = 'cancelled', updated_at = now()
FROM offer_versions o WHERE d.offer_version_id = o.id AND o.state = 'revoked' AND d.state = 'scheduled';
--> statement-breakpoint
ALTER TABLE "rate_periods" DROP CONSTRAINT "rate_periods_no_overlap";
--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_no_overlap" EXCLUDE USING gist (
  "room_id" WITH =,
  "plan_key" WITH =,
  "meal_plan" WITH =,
  daterange("start_date", "end_date_exclusive", '[)') WITH &&
) WHERE ("deleted_at" IS NULL AND "active" = true);
--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_meal_plan_valid" CHECK ("inquiries"."meal_plan" IN ('BB', 'HB', 'FB'));--> statement-breakpoint
ALTER TABLE "rate_periods" ADD CONSTRAINT "rate_periods_meal_plan_valid" CHECK ("rate_periods"."deleted_at" IS NOT NULL OR "rate_periods"."meal_plan" IN ('BB', 'HB', 'FB'));