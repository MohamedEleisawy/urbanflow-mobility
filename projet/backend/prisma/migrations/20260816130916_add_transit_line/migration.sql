-- AlterTable
ALTER TABLE "network_links" DROP COLUMN "lineName",
DROP COLUMN "mode",
DROP COLUMN "operator",
ADD COLUMN     "lineId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "stops" ADD COLUMN     "gtfsStopId" TEXT;

-- CreateTable
CREATE TABLE "transit_lines" (
    "id" UUID NOT NULL,
    "gtfsRouteId" TEXT,
    "name" TEXT NOT NULL,
    "mode" "ModeTransport" NOT NULL,
    "operator" TEXT NOT NULL,

    CONSTRAINT "transit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_lines_gtfsRouteId_key" ON "transit_lines"("gtfsRouteId");

-- CreateIndex
CREATE UNIQUE INDEX "network_links_lineId_fromStopId_toStopId_key" ON "network_links"("lineId", "fromStopId", "toStopId");

-- CreateIndex
CREATE UNIQUE INDEX "stops_gtfsStopId_key" ON "stops"("gtfsStopId");

-- AddForeignKey
ALTER TABLE "network_links" ADD CONSTRAINT "network_links_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

