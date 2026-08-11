CREATE TABLE IF NOT EXISTS "setup_claim" (
	"id" integer PRIMARY KEY NOT NULL,
	"claimed_at" bigint NOT NULL,
	CONSTRAINT "setup_claim_id_is_one" CHECK ("setup_claim"."id" = 1)
);
