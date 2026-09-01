-- CreateEnum
CREATE TYPE "FavoriteAddressType" AS ENUM ('HOME', 'WORK');

-- CreateTable
CREATE TABLE "favorite_addresses" (
    "id" UUID NOT NULL,
    "type" "FavoriteAddressType" NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,

    CONSTRAINT "favorite_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "favorite_addresses_userId_type_key" ON "favorite_addresses"("userId", "type");

-- AddForeignKey
ALTER TABLE "favorite_addresses" ADD CONSTRAINT "favorite_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
