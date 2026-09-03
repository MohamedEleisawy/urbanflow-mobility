-- CreateTable
CREATE TABLE "transit_services" (
    "id" UUID NOT NULL,
    "gtfsServiceId" TEXT NOT NULL,
    "monday" BOOLEAN NOT NULL,
    "tuesday" BOOLEAN NOT NULL,
    "wednesday" BOOLEAN NOT NULL,
    "thursday" BOOLEAN NOT NULL,
    "friday" BOOLEAN NOT NULL,
    "saturday" BOOLEAN NOT NULL,
    "sunday" BOOLEAN NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "transit_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_service_exceptions" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "added" BOOLEAN NOT NULL,

    CONSTRAINT "transit_service_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_departures" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "departureSec" INTEGER NOT NULL,
    "headsign" TEXT,

    CONSTRAINT "stop_departures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_services_gtfsServiceId_key" ON "transit_services"("gtfsServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_service_exceptions_serviceId_date_key" ON "transit_service_exceptions"("serviceId", "date");

-- CreateIndex
CREATE INDEX "stop_departures_stopId_departureSec_idx" ON "stop_departures"("stopId", "departureSec");

-- AddForeignKey
ALTER TABLE "transit_service_exceptions" ADD CONSTRAINT "transit_service_exceptions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "transit_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_departures" ADD CONSTRAINT "stop_departures_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_departures" ADD CONSTRAINT "stop_departures_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_departures" ADD CONSTRAINT "stop_departures_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "transit_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
