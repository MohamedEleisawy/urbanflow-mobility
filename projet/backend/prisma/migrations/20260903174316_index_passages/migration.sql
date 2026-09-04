-- CreateIndex
CREATE INDEX "stop_departures_lineId_idx" ON "stop_departures"("lineId");

-- CreateIndex
CREATE INDEX "stop_departures_serviceId_departureSec_idx" ON "stop_departures"("serviceId", "departureSec");
