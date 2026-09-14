CREATE TYPE "public"."founder_role" AS ENUM('founder', 'cofounder', 'ceo', 'cto', 'operator', 'advisor', 'early_employee');--> statement-breakpoint
CREATE TYPE "public"."headcount_band" AS ENUM('1-10', '11-50', '51-200', '201-500', '501-1000', '1000+');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('dry_run', 'committed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."investor_type" AS ENUM('vc', 'accelerator', 'angel', 'corporate', 'pe', 'government', 'crowdfunding');--> statement-breakpoint
CREATE TYPE "public"."media_purpose" AS ENUM('logo', 'cover', 'photo', 'og');--> statement-breakpoint
CREATE TYPE "public"."media_state" AS ENUM('staging', 'attached');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."round_class" AS ENUM('equity', 'convertible', 'debt', 'non_dilutive', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."round_type" AS ENUM('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'series_e', 'series_f', 'series_g', 'convertible', 'bridge', 'debt', 'grant', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('bootstrapped', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'series_e', 'series_f', 'series_g', 'growth', 'public', 'acquired', 'dead');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_kind" AS ENUM('industry', 'stage', 'work_type', 'city', 'country');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."work_type" AS ENUM('remote', 'onsite', 'hybrid');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'editor' NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"slug" text NOT NULL,
	"investor_id" uuid,
	"program_name" text NOT NULL,
	"label" text NOT NULL,
	"season" text,
	"year" integer NOT NULL,
	"starts_on" date,
	"demo_day_on" date,
	"description" text,
	"logo_asset_id" uuid,
	"og_asset_id" uuid,
	CONSTRAINT "batches_slug_unique" UNIQUE("slug"),
	CONSTRAINT "batches_investor_label_year_key" UNIQUE NULLS NOT DISTINCT("investor_id","label","year"),
	CONSTRAINT "batches_slug_format" CHECK ("batches"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "batches_archived_at_matches_status" CHECK (("batches"."status" = 'archived') = ("batches"."archived_at" is not null)),
	CONSTRAINT "batches_published_has_first_published_at" CHECK ("batches"."status" <> 'published' or "batches"."first_published_at" is not null),
	CONSTRAINT "batches_year_min" CHECK ("batches"."year" >= 1990),
	CONSTRAINT "batches_demo_day_after_start" CHECK ("batches"."demo_day_on" is null or "batches"."starts_on" is null or "batches"."demo_day_on" >= "batches"."starts_on"),
	CONSTRAINT "batches_description_length" CHECK (char_length("batches"."description") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "founders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"slug" text NOT NULL,
	"full_name" text NOT NULL,
	"headline" text,
	"bio" text,
	"photo_asset_id" uuid,
	"og_asset_id" uuid,
	"linkedin_url" text,
	"x_url" text,
	"github_url" text,
	"personal_url" text,
	"location_id" uuid,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("full_name", ''))), 'A') || setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("headline", ''))), 'B') || setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("bio", ''))), 'C')) STORED,
	CONSTRAINT "founders_slug_unique" UNIQUE("slug"),
	CONSTRAINT "founders_slug_format" CHECK ("founders"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "founders_archived_at_matches_status" CHECK (("founders"."status" = 'archived') = ("founders"."archived_at" is not null)),
	CONSTRAINT "founders_published_has_first_published_at" CHECK ("founders"."status" <> 'published' or "founders"."first_published_at" is not null),
	CONSTRAINT "founders_linkedin_url_https" CHECK ("founders"."linkedin_url" ~ '^https://'),
	CONSTRAINT "founders_x_url_https" CHECK ("founders"."x_url" ~ '^https://'),
	CONSTRAINT "founders_github_url_https" CHECK ("founders"."github_url" ~ '^https://'),
	CONSTRAINT "founders_personal_url_https" CHECK ("founders"."personal_url" ~ '^https://'),
	CONSTRAINT "founders_headline_length" CHECK (char_length("founders"."headline") <= 160),
	CONSTRAINT "founders_bio_length" CHECK (char_length("founders"."bio") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"usd_per_unit" numeric(18, 8) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rates_currency_rate_date_pk" PRIMARY KEY("currency","rate_date"),
	CONSTRAINT "fx_rates_currency_format" CHECK ("fx_rates"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rates_usd_per_unit_positive" CHECK ("fx_rates"."usd_per_unit" > 0),
	CONSTRAINT "fx_rates_source" CHECK ("fx_rates"."source" in ('ecb', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"description" text,
	CONSTRAINT "industries_slug_unique" UNIQUE("slug"),
	CONSTRAINT "industries_slug_format" CHECK ("industries"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"investor_type" "investor_type" NOT NULL,
	"description" text,
	"logo_asset_id" uuid,
	"og_asset_id" uuid,
	"website_url" text,
	"founded_year" integer,
	"hq_location_id" uuid,
	"aum_usd" bigint,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("name", ''))), 'A') || setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("description", ''))), 'C')) STORED,
	CONSTRAINT "investors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "investors_slug_format" CHECK ("investors"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "investors_archived_at_matches_status" CHECK (("investors"."status" = 'archived') = ("investors"."archived_at" is not null)),
	CONSTRAINT "investors_published_has_first_published_at" CHECK ("investors"."status" <> 'published' or "investors"."first_published_at" is not null),
	CONSTRAINT "investors_website_url_https" CHECK ("investors"."website_url" ~ '^https://'),
	CONSTRAINT "investors_description_length" CHECK (char_length("investors"."description") <= 4000),
	CONSTRAINT "investors_founded_year_min" CHECK ("investors"."founded_year" >= 1900),
	CONSTRAINT "investors_aum_non_negative" CHECK ("investors"."aum_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"round_id" uuid,
	"is_lead" boolean DEFAULT false NOT NULL,
	"amount_usd" bigint,
	CONSTRAINT "investments_startup_investor_round_key" UNIQUE NULLS NOT DISTINCT("startup_id","investor_id","round_id"),
	CONSTRAINT "investments_amount_non_negative" CHECK ("investments"."amount_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "startup_batches" (
	"startup_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	CONSTRAINT "startup_batches_startup_id_batch_id_pk" PRIMARY KEY("startup_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "startup_founders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"founder_id" uuid NOT NULL,
	"role" "founder_role" NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"joined_year" integer,
	"left_year" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	CONSTRAINT "startup_founders_stint_key" UNIQUE NULLS NOT DISTINCT("startup_id","founder_id","role","joined_year"),
	CONSTRAINT "startup_founders_left_after_joined" CHECK ("startup_founders"."left_year" is null or "startup_founders"."joined_year" is null or "startup_founders"."left_year" >= "startup_founders"."joined_year"),
	CONSTRAINT "startup_founders_current_has_not_left" CHECK (not ("startup_founders"."is_current" and "startup_founders"."left_year" is not null)),
	CONSTRAINT "startup_founders_source_url_https" CHECK ("startup_founders"."source_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "startup_industries" (
	"startup_id" uuid NOT NULL,
	"industry_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "startup_industries_startup_id_industry_id_pk" PRIMARY KEY("startup_id","industry_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"city" text,
	"region" text,
	"country" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	CONSTRAINT "locations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "locations_city_country_code_key" UNIQUE NULLS NOT DISTINCT("city","country_code"),
	CONSTRAINT "locations_slug_format" CHECK ("locations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "locations_country_code_format" CHECK ("locations"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "locations_lat_range" CHECK ("locations"."lat" between -90 and 90),
	CONSTRAINT "locations_lng_range" CHECK ("locations"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_prefix" text NOT NULL,
	"purpose" "media_purpose" NOT NULL,
	"state" "media_state" DEFAULT 'staging' NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blur_data_url" text,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	CONSTRAINT "media_assets_blob_prefix_unique" UNIQUE("blob_prefix"),
	CONSTRAINT "media_assets_attached_at_matches_state" CHECK (("media_assets"."state" = 'attached') = ("media_assets"."attached_at" is not null)),
	CONSTRAINT "media_assets_blur_is_image_data_url" CHECK ("media_assets"."blur_data_url" ~ '^data:image/(webp|jpeg|png).base64,'),
	CONSTRAINT "media_assets_variants_is_array" CHECK (jsonb_typeof("media_assets"."variants") = 'array'),
	CONSTRAINT "media_assets_source_url_https" CHECK ("media_assets"."source_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"actor_id" uuid,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action" CHECK ("audit_log"."action" in ('create', 'update', 'archive', 'restore', 'publish', 'unpublish', 'slug_change', 'hard_delete', 'erase'))
);
--> statement-breakpoint
CREATE TABLE "erasure_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id_hash" char(64) NOT NULL,
	"actor_id" uuid NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erasure_log_entity_type" CHECK ("erasure_log"."entity_type" in ('founder')),
	CONSTRAINT "erasure_log_entity_id_hash_hex" CHECK ("erasure_log"."entity_id_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" char(64) NOT NULL,
	"status" "import_status" DEFAULT 'dry_run' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"create_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_jobs_sha256_hex" CHECK ("import_jobs"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_jobs_row_count_range" CHECK ("import_jobs"."row_count" between 0 and 1000),
	CONSTRAINT "import_jobs_counts_non_negative" CHECK ("import_jobs"."create_count" >= 0 and "import_jobs"."update_count" >= 0 and "import_jobs"."skip_count" >= 0 and "import_jobs"."error_count" >= 0),
	CONSTRAINT "import_jobs_committed_at_matches_status" CHECK (("import_jobs"."status" = 'committed') = ("import_jobs"."committed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"old_slug" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slug_redirects_entity_type_old_slug_key" UNIQUE("entity_type","old_slug"),
	CONSTRAINT "slug_redirects_entity_type" CHECK ("slug_redirects"."entity_type" in ('startup', 'founder', 'investor', 'batch')),
	CONSTRAINT "slug_redirects_old_slug_format" CHECK ("slug_redirects"."old_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "funding_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"startup_id" uuid NOT NULL,
	"round_type" "round_type" NOT NULL,
	"round_class" "round_class" GENERATED ALWAYS AS (CASE "round_type" WHEN 'convertible' THEN 'convertible'::round_class WHEN 'bridge' THEN 'convertible'::round_class WHEN 'debt' THEN 'debt'::round_class WHEN 'grant' THEN 'non_dilutive'::round_class WHEN 'secondary' THEN 'secondary'::round_class ELSE 'equity'::round_class END) STORED,
	"announced_on" date NOT NULL,
	"is_undisclosed" boolean DEFAULT false NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"amount_original" numeric(20, 2),
	"amount_usd" bigint,
	"fx_rate" numeric(18, 8),
	"fx_rate_date" date,
	"fx_source" text,
	"valuation_usd" bigint,
	"source_url" text NOT NULL,
	"source_title" text,
	"notes" text,
	CONSTRAINT "funding_rounds_archived_at_matches_status" CHECK (("funding_rounds"."status" = 'archived') = ("funding_rounds"."archived_at" is not null)),
	CONSTRAINT "funding_rounds_published_has_first_published_at" CHECK ("funding_rounds"."status" <> 'published' or "funding_rounds"."first_published_at" is not null),
	CONSTRAINT "funding_rounds_source_url_https" CHECK ("funding_rounds"."source_url" ~ '^https://'),
	CONSTRAINT "funding_rounds_undisclosed_has_no_amount" CHECK (("funding_rounds"."is_undisclosed" and "funding_rounds"."amount_original" is null and "funding_rounds"."amount_usd" is null) or (not "funding_rounds"."is_undisclosed" and "funding_rounds"."amount_original" is not null and "funding_rounds"."amount_usd" is not null)),
	CONSTRAINT "funding_rounds_non_usd_has_fx" CHECK ("funding_rounds"."currency" = 'USD' or "funding_rounds"."is_undisclosed" or ("funding_rounds"."fx_rate" is not null and "funding_rounds"."fx_rate_date" is not null and "funding_rounds"."fx_source" is not null)),
	CONSTRAINT "funding_rounds_currency_format" CHECK ("funding_rounds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "funding_rounds_fx_source" CHECK ("funding_rounds"."fx_source" in ('ecb', 'manual')),
	CONSTRAINT "funding_rounds_fx_rate_positive" CHECK ("funding_rounds"."fx_rate" > 0),
	CONSTRAINT "funding_rounds_fx_rate_not_after_announcement" CHECK ("funding_rounds"."fx_rate_date" <= "funding_rounds"."announced_on"),
	CONSTRAINT "funding_rounds_amounts_non_negative" CHECK (coalesce("funding_rounds"."amount_original", 0) >= 0 and coalesce("funding_rounds"."amount_usd", 0) >= 0 and coalesce("funding_rounds"."valuation_usd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "startups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"tagline" text,
	"description" text,
	"website_url" text,
	"careers_url" text,
	"linkedin_url" text,
	"x_url" text,
	"github_url" text,
	"logo_asset_id" uuid,
	"cover_asset_id" uuid,
	"og_asset_id" uuid,
	"stage" "stage",
	"work_type" "work_type",
	"headcount_band" "headcount_band",
	"founded_year" integer,
	"founded_on" date,
	"location_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"acquired_by_startup_id" uuid,
	"acquired_by_name" text,
	"acquired_on" date,
	"acquired_amount_usd" bigint,
	"total_raised_usd" bigint DEFAULT 0 NOT NULL,
	"total_debt_usd" bigint DEFAULT 0 NOT NULL,
	"latest_round_id" uuid,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("name", ''))), 'A') || setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("tagline", ''))), 'B') || setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("description", ''))), 'C')) STORED,
	CONSTRAINT "startups_slug_unique" UNIQUE("slug"),
	CONSTRAINT "startups_slug_format" CHECK ("startups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "startups_archived_at_matches_status" CHECK (("startups"."status" = 'archived') = ("startups"."archived_at" is not null)),
	CONSTRAINT "startups_published_has_first_published_at" CHECK ("startups"."status" <> 'published' or "startups"."first_published_at" is not null),
	CONSTRAINT "startups_website_url_https" CHECK ("startups"."website_url" ~ '^https://'),
	CONSTRAINT "startups_careers_url_https" CHECK ("startups"."careers_url" ~ '^https://'),
	CONSTRAINT "startups_linkedin_url_https" CHECK ("startups"."linkedin_url" ~ '^https://'),
	CONSTRAINT "startups_x_url_https" CHECK ("startups"."x_url" ~ '^https://'),
	CONSTRAINT "startups_github_url_https" CHECK ("startups"."github_url" ~ '^https://'),
	CONSTRAINT "startups_tagline_length" CHECK (char_length("startups"."tagline") <= 120),
	CONSTRAINT "startups_description_length" CHECK (char_length("startups"."description") <= 4000),
	CONSTRAINT "startups_founded_year_min" CHECK ("startups"."founded_year" >= 1900),
	CONSTRAINT "startups_founded_on_matches_year" CHECK ("startups"."founded_on" is null or "startups"."founded_year" is null or extract(year from "startups"."founded_on") = "startups"."founded_year"),
	CONSTRAINT "startups_acquisition_has_acquirer" CHECK ("startups"."acquired_on" is null or "startups"."acquired_by_startup_id" is not null or "startups"."acquired_by_name" is not null),
	CONSTRAINT "startups_not_acquired_by_itself" CHECK ("startups"."acquired_by_startup_id" <> "startups"."id"),
	CONSTRAINT "startups_amounts_non_negative" CHECK ("startups"."total_raised_usd" >= 0 and "startups"."total_debt_usd" >= 0 and coalesce("startups"."acquired_amount_usd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "taxonomy_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "taxonomy_kind" NOT NULL,
	"slug" text NOT NULL,
	"heading" text,
	"intro" text,
	"icon_url" text,
	"seo_title" text,
	"seo_description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "taxonomy_pages_kind_slug_key" UNIQUE("kind","slug"),
	CONSTRAINT "taxonomy_pages_slug_format" CHECK ("taxonomy_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_og_asset_id_media_assets_id_fk" FOREIGN KEY ("og_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_photo_asset_id_media_assets_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_og_asset_id_media_assets_id_fk" FOREIGN KEY ("og_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_og_asset_id_media_assets_id_fk" FOREIGN KEY ("og_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_hq_location_id_locations_id_fk" FOREIGN KEY ("hq_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_round_id_funding_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."funding_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_batches" ADD CONSTRAINT "startup_batches_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_batches" ADD CONSTRAINT "startup_batches_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_founders" ADD CONSTRAINT "startup_founders_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_founders" ADD CONSTRAINT "startup_founders_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_industries" ADD CONSTRAINT "startup_industries_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_industries" ADD CONSTRAINT "startup_industries_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_log" ADD CONSTRAINT "erasure_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_rounds" ADD CONSTRAINT "funding_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_rounds" ADD CONSTRAINT "funding_rounds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_rounds" ADD CONSTRAINT "funding_rounds_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_og_asset_id_media_assets_id_fk" FOREIGN KEY ("og_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_acquired_by_startup_id_startups_id_fk" FOREIGN KEY ("acquired_by_startup_id") REFERENCES "public"."startups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_latest_round_id_funding_rounds_id_fk" FOREIGN KEY ("latest_round_id") REFERENCES "public"."funding_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "batches_investor_idx" ON "batches" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "batches_program_name_trgm_idx" ON "batches" USING gin (public.immutable_unaccent(lower("program_name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "batches_status_year_idx" ON "batches" USING btree ("status","year" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "founders_search_vector_idx" ON "founders" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "founders_full_name_trgm_idx" ON "founders" USING gin (public.immutable_unaccent(lower("full_name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "founders_status_created_at_idx" ON "founders" USING btree ("status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "investors_search_vector_idx" ON "investors" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "investors_name_trgm_idx" ON "investors" USING gin (public.immutable_unaccent(lower("name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "investors_status_created_at_idx" ON "investors" USING btree ("status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "investments_investor_idx" ON "investments" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "investments_round_idx" ON "investments" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "startup_batches_batch_idx" ON "startup_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "startup_founders_founder_joined_idx" ON "startup_founders" USING btree ("founder_id","joined_year" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "startup_industries_one_primary_idx" ON "startup_industries" USING btree ("startup_id") WHERE "startup_industries"."is_primary";--> statement-breakpoint
CREATE INDEX "startup_industries_industry_idx" ON "startup_industries" USING btree ("industry_id");--> statement-breakpoint
CREATE INDEX "media_assets_state_created_at_idx" ON "media_assets" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "import_jobs_actor_created_at_idx" ON "import_jobs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "slug_redirects_entity_idx" ON "slug_redirects" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "funding_rounds_status_announced_on_idx" ON "funding_rounds" USING btree ("status","announced_on" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "funding_rounds_startup_announced_on_idx" ON "funding_rounds" USING btree ("startup_id","announced_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "startups_search_vector_idx" ON "startups" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "startups_name_trgm_idx" ON "startups" USING gin (public.immutable_unaccent(lower("name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "startups_status_created_at_idx" ON "startups" USING btree ("status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "startups_status_total_raised_idx" ON "startups" USING btree ("status","total_raised_usd" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "startups_status_name_idx" ON "startups" USING btree ("status",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "startups_status_stage_idx" ON "startups" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "startups_status_location_idx" ON "startups" USING btree ("status","location_id");--> statement-breakpoint
CREATE INDEX "startups_acquired_by_idx" ON "startups" USING btree ("acquired_by_startup_id");