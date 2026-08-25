-- CreateIndex
CREATE INDEX "Profile_searchVector_idx" ON "Profile" USING GIN ("searchVector" tsvector_ops);
