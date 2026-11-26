-- A client-chosen id per post, so a retried send returns the message the
-- first attempt created instead of posting it twice. Nullable: existing rows
-- and clients that send none are never deduplicated (Postgres treats NULLs
-- as distinct in a unique index).
ALTER TABLE "ChatMessage" ADD COLUMN "clientId" TEXT;

CREATE UNIQUE INDEX "ChatMessage_channelId_authorId_clientId_key" ON "ChatMessage"("channelId", "authorId", "clientId");
