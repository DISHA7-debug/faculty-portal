-- CreateTable
CREATE TABLE "CustomSection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "columns" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomItem" (
    "id" TEXT NOT NULL,
    "customSectionId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomSection_profileId_sortOrder_idx" ON "CustomSection"("profileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomSection_profileId_slug_key" ON "CustomSection"("profileId", "slug");

-- CreateIndex
CREATE INDEX "CustomItem_customSectionId_sortOrder_idx" ON "CustomItem"("customSectionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "CustomSection" ADD CONSTRAINT "CustomSection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomItem" ADD CONSTRAINT "CustomItem_customSectionId_fkey" FOREIGN KEY ("customSectionId") REFERENCES "CustomSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
