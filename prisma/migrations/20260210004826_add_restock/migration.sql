-- CreateTable
CREATE TABLE "restock_records" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "totalCost" INTEGER,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "supplier" TEXT,
    "invoiceNumber" TEXT,
    "notes" TEXT,
    "restockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_history" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restock_records_productId_idx" ON "restock_records"("productId");

-- CreateIndex
CREATE INDEX "restock_records_restockedAt_idx" ON "restock_records"("restockedAt");

-- CreateIndex
CREATE INDEX "restock_records_batchNumber_idx" ON "restock_records"("batchNumber");

-- CreateIndex
CREATE INDEX "restock_records_supplier_idx" ON "restock_records"("supplier");

-- CreateIndex
CREATE INDEX "cost_history_productId_idx" ON "cost_history"("productId");

-- CreateIndex
CREATE INDEX "cost_history_effectiveFrom_idx" ON "cost_history"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "restock_records" ADD CONSTRAINT "restock_records_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_history" ADD CONSTRAINT "cost_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
