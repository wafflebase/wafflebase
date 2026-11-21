-- AlterTable
ALTER TABLE "ChatChannel" ADD COLUMN "defaultKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_defaultKey_key" ON "ChatChannel"("defaultKey");

-- Backfill: every workspace gets a default channel. A public channel already
-- named "general" is adopted (and unarchived, since a default channel cannot
-- be archived); otherwise one is created, owned by the workspace's first
-- owner. A workspace whose "general" is private keeps it and gets no default:
-- channel names are unique per workspace and a private channel cannot be made
-- public without exposing its history.
UPDATE "ChatChannel"
SET "defaultKey" = "workspaceId", "archivedAt" = NULL
WHERE "kind" = 'public' AND "name" = 'general';

INSERT INTO "ChatChannel" ("id", "workspaceId", "kind", "name", "createdBy", "defaultKey")
SELECT gen_random_uuid()::text, w."id", 'public', 'general',
       (SELECT m."userId" FROM "WorkspaceMember" m
        WHERE m."workspaceId" = w."id" AND m."role" = 'owner'
        ORDER BY m."userId" LIMIT 1),
       w."id"
FROM "Workspace" w
WHERE NOT EXISTS (
  SELECT 1 FROM "ChatChannel" c
  WHERE c."workspaceId" = w."id" AND c."name" = 'general'
);

-- Every workspace member joins its default channel at the tail, so the
-- history from before they were added is not unread.
INSERT INTO "ChatChannelMember" ("channelId", "userId", "lastReadSeq")
SELECT c."id", m."userId", c."lastSeq"
FROM "ChatChannel" c
JOIN "WorkspaceMember" m ON m."workspaceId" = c."workspaceId"
WHERE c."defaultKey" IS NOT NULL
ON CONFLICT ("channelId", "userId") DO NOTHING;
