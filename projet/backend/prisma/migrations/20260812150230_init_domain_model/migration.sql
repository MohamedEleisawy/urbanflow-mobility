-- CreateEnum
CREATE TYPE "RoleEnum" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ThemeEnum" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LanguageEnum" AS ENUM ('FR', 'EN');

-- CreateEnum
CREATE TYPE "ModeTransport" AS ENUM ('WALK', 'BUS', 'TRAM', 'METRO', 'BIKE', 'ESCOOTER', 'CAR');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'SEVERE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "RoleEnum" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL,
    "preferredModes" "ModeTransport"[],
    "pmrMode" BOOLEAN NOT NULL DEFAULT false,
    "co2BudgetWeekly" DOUBLE PRECISION NOT NULL,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "language" "LanguageEnum" NOT NULL DEFAULT 'FR',
    "theme" "ThemeEnum" NOT NULL DEFAULT 'SYSTEM',
    "userId" UUID NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDurationMin" INTEGER NOT NULL,
    "totalDistanceM" INTEGER NOT NULL,
    "ecoScore" DOUBLE PRECISION NOT NULL,
    "carbonEstimate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "mode" "ModeTransport" NOT NULL,
    "operator" TEXT NOT NULL,
    "departureTime" TIMESTAMP(3) NOT NULL,
    "arrivalTime" TIMESTAMP(3) NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "line" TEXT NOT NULL,
    "gtfsTripId" TEXT NOT NULL,
    "routeId" UUID NOT NULL,
    "fromStopId" UUID NOT NULL,
    "toStopId" UUID NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "pmrAccessible" BOOLEAN NOT NULL DEFAULT false,
    "operatorCode" TEXT NOT NULL,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_records" (
    "id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "co2Grams" DOUBLE PRECISION NOT NULL,
    "mode" "ModeTransport" NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "savedVsCarGrams" DOUBLE PRECISION NOT NULL,
    "userId" UUID NOT NULL,
    "routeId" UUID NOT NULL,

    CONSTRAINT "carbon_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_budgets" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "weeklyBudgetGrams" DOUBLE PRECISION NOT NULL,
    "consumedWeeklyGrams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userId" UUID NOT NULL,

    CONSTRAINT "carbon_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "stopIds" TEXT[],
    "lineIds" TEXT[],
    "affectedMode" "ModeTransport" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "cause" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "gtfsAlertId" TEXT NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "carbon_budgets_userId_year_week_key" ON "carbon_budgets"("userId", "year", "week");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_gtfsAlertId_key" ON "alerts"("gtfsAlertId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_fromStopId_fkey" FOREIGN KEY ("fromStopId") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_toStopId_fkey" FOREIGN KEY ("toStopId") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carbon_records" ADD CONSTRAINT "carbon_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carbon_records" ADD CONSTRAINT "carbon_records_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carbon_budgets" ADD CONSTRAINT "carbon_budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
