-- CreateTable
CREATE TABLE "UserDocStyles" (
    "userId" INTEGER NOT NULL,
    "styles" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDocStyles_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserDocStyles" ADD CONSTRAINT "UserDocStyles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
