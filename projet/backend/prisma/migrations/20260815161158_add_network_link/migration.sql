-- CreateTable
CREATE TABLE "network_links" (
    "id" UUID NOT NULL,
    "mode" "ModeTransport" NOT NULL,
    "lineName" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "fromStopId" UUID NOT NULL,
    "toStopId" UUID NOT NULL,

    CONSTRAINT "network_links_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_fromStopId_fkey" FOREIGN KEY ("fromStopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_toStopId_fkey" FOREIGN KEY ("toStopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
