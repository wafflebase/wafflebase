-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "agentTaskId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "botInvokers" TEXT,
ADD COLUMN     "botLastSeenAt" TIMESTAMP(3),
ADD COLUMN     "botOwnerId" INTEGER,
ADD COLUMN     "botWorkspaceId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'person';

-- CreateTable
CREATE TABLE "BotPairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "botId" INTEGER NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "botId" INTEGER NOT NULL,
    "invokerId" INTEGER NOT NULL,
    "triggerMessageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadRootId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "claimedAt" TIMESTAMP(3),
    "claimedByKeyId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotPairingCode_code_key" ON "BotPairingCode"("code");

-- CreateIndex
CREATE INDEX "BotPairingCode_botId_idx" ON "BotPairingCode"("botId");

-- CreateIndex
CREATE INDEX "AgentTask_botId_status_createdAt_idx" ON "AgentTask"("botId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTask_workspaceId_idx" ON "AgentTask"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentTask_channelId_idx" ON "AgentTask"("channelId");

-- CreateIndex
CREATE INDEX "ChatMessage_agentTaskId_idx" ON "ChatMessage"("agentTaskId");

-- CreateIndex
CREATE INDEX "User_botWorkspaceId_idx" ON "User"("botWorkspaceId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_botOwnerId_fkey" FOREIGN KEY ("botOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_botWorkspaceId_fkey" FOREIGN KEY ("botWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotPairingCode" ADD CONSTRAINT "BotPairingCode_botId_fkey" FOREIGN KEY ("botId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotPairingCode" ADD CONSTRAINT "BotPairingCode_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_botId_fkey" FOREIGN KEY ("botId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_invokerId_fkey" FOREIGN KEY ("invokerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

