CREATE TABLE "service_dependency" (
	"base_service_id" uuid,
	"affected_service_id" uuid,
	CONSTRAINT "service_dependency_pkey" PRIMARY KEY("base_service_id","affected_service_id")
);
--> statement-breakpoint
CREATE INDEX "service_dependency_base_idx" ON "service_dependency" ("base_service_id");--> statement-breakpoint
CREATE INDEX "service_dependency_affected_idx" ON "service_dependency" ("affected_service_id");--> statement-breakpoint
ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_base_service_id_service_id_fkey" FOREIGN KEY ("base_service_id") REFERENCES "service"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_affected_service_id_service_id_fkey" FOREIGN KEY ("affected_service_id") REFERENCES "service"("id") ON DELETE CASCADE;