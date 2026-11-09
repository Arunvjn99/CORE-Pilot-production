ALTER TABLE "llm_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_llm_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- No DELETE on credentials: revocation is an UPDATE that destroys key material (checked by constraint) and keeps the audit trail.
GRANT SELECT, INSERT, UPDATE ON "llm_credentials" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "platform_llm_credentials" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "platform_llm_entitlements" TO core_app;--> statement-breakpoint
GRANT UPDATE ("name", "updated_at", "allow_personal_credentials") ON "organizations" TO core_app;
