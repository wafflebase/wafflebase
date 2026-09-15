-- Deliberately NULL for every existing row: nothing recorded whether the
-- address a row was created from had been verified by its provider, and a
-- GitHub primary address may be unverified. A cross-provider sign-in refuses
-- to merge into a row that is still null; signing in again with the provider
-- that created it stamps the column.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
