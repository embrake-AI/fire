ALTER TABLE "status_page" DROP COLUMN "description";
ALTER TABLE "status_page" ADD COLUMN "logo_url" text;
ALTER TABLE "status_page" ADD COLUMN "custom_domain" text;
ALTER TABLE "status_page" ADD COLUMN "privacy_policy_url" text;
ALTER TABLE "status_page" ADD COLUMN "terms_of_service_url" text;
