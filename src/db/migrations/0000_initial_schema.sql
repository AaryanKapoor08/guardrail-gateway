CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"snaptrade_account_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"name" text NOT NULL,
	"number_last4" text NOT NULL,
	"raw_type" text NOT NULL,
	"account_category" text,
	"is_paper" boolean NOT NULL,
	"allowed" boolean DEFAULT false NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_user_id_snaptrade_account_id_unique" UNIQUE("user_id","snaptrade_account_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_id" uuid,
	"actor" text NOT NULL,
	"actor_detail" text,
	"event_type" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK ("audit_events"."actor" in ('ai', 'user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"brokerage_name" text NOT NULL,
	"type" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connections_type_check" CHECK ("connections"."type" in ('read', 'trade'))
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"intent_id" uuid PRIMARY KEY NOT NULL,
	"executor" text NOT NULL,
	"client_order_id" uuid,
	"brokerage_order_id" text,
	"submitted_at" timestamp with time zone,
	"filled_quantity" numeric DEFAULT '0' NOT NULL,
	"avg_fill_price" numeric,
	"broker_status" text,
	"last_checked_at" timestamp with time zone,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_executor_check" CHECK ("executions"."executor" in ('paper', 'snaptrade'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"nonce" text NOT NULL,
	"return_to" text,
	"mcp_auth_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "login_attempts_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "mcp_auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"client_host" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_kind_check" CHECK ("mcp_tokens"."kind" in ('access', 'refresh'))
);
--> statement-breakpoint
CREATE TABLE "order_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"grant_id" uuid,
	"idempotency_key" uuid,
	"fingerprint" text NOT NULL,
	"symbol" text NOT NULL,
	"universal_symbol_id" uuid NOT NULL,
	"security_type" text NOT NULL,
	"currency" text NOT NULL,
	"exchange" text,
	"side" text NOT NULL,
	"quantity" numeric NOT NULL,
	"order_type" text NOT NULL,
	"limit_price" numeric,
	"time_in_force" text DEFAULT 'Day' NOT NULL,
	"mode" text NOT NULL,
	"est_price" numeric,
	"est_value" numeric,
	"price_source" text NOT NULL,
	"price_as_of" timestamp with time zone,
	"status" text NOT NULL,
	"check_results" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_intents_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "order_intents_side_check" CHECK ("order_intents"."side" in ('buy', 'sell')),
	CONSTRAINT "order_intents_order_type_check" CHECK ("order_intents"."order_type" in ('market', 'limit')),
	CONSTRAINT "order_intents_mode_check" CHECK ("order_intents"."mode" in ('paper', 'live')),
	CONSTRAINT "order_intents_status_check" CHECK ("order_intents"."status" in ('PROPOSED', 'POLICY_REJECTED', 'PENDING_APPROVAL', 'DENIED', 'EXPIRED', 'CANCELLED', 'APPROVED', 'EXECUTING', 'SUBMITTED', 'UNKNOWN', 'FILLED', 'CLOSED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "paper_cash" (
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"currency" text NOT NULL,
	"cash_change" numeric NOT NULL,
	CONSTRAINT "paper_cash_user_id_account_id_currency_pk" PRIMARY KEY("user_id","account_id","currency")
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" numeric NOT NULL,
	"avg_cost" numeric NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "paper_positions_user_id_account_id_symbol_pk" PRIMARY KEY("user_id","account_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snaptrade_grants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snaptrade_sub" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_snaptrade_sub_unique" UNIQUE("snaptrade_sub"),
	CONSTRAINT "users_mode_check" CHECK ("users"."mode" in ('paper', 'live'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"webhook_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"user_sub" text NOT NULL,
	"connection_id" text,
	"account_id" text,
	"event_timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_intent_id_order_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."order_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_requests" ADD CONSTRAINT "mcp_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_cash" ADD CONSTRAINT "paper_cash_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_cash" ADD CONSTRAINT "paper_cash_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaptrade_grants" ADD CONSTRAINT "snaptrade_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_tokens_grant_id_idx" ON "mcp_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "order_intents_user_id_created_at_idx" ON "order_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_intents_status_expires_at_idx" ON "order_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "users_is_demo_created_at_idx" ON "users" USING btree ("is_demo","created_at");