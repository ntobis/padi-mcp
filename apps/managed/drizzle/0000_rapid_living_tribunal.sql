CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workos_user_id" text NOT NULL,
	"action" text NOT NULL,
	"dive_id" bigint,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "padi_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_user_id" text NOT NULL,
	"affiliate_id" text NOT NULL,
	"cognito_sub" text NOT NULL,
	"padi_username" text NOT NULL,
	"enc_refresh_token" text NOT NULL,
	"enc_nonce" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"workos_user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "padi_connections" ADD CONSTRAINT "padi_connections_workos_user_id_users_workos_user_id_fk" FOREIGN KEY ("workos_user_id") REFERENCES "public"."users"("workos_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "padi_connections_workos_user_id_key" ON "padi_connections" USING btree ("workos_user_id");