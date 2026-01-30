-- Add created_at to status_page_service (applied manually)
ALTER TABLE "status_page_service" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- service_display_mode on status_page was already present
