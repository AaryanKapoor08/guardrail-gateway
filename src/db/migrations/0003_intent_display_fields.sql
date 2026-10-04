ALTER TABLE "order_intents" ADD COLUMN "proposed_by" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_intents" ADD COLUMN "raw_symbol" text;--> statement-breakpoint
ALTER TABLE "order_intents" ADD COLUMN "security_name" text;