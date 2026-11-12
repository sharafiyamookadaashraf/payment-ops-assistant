-- Refuse to silently round existing amounts. Correct any rejected demo rows
-- before applying this migration; existing two-decimal CSV amounts are safe.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Transaction"
    WHERE "amount"::numeric != round("amount"::numeric, 2)
       OR "amount" <= 0 OR "amount" > 9999999999.99) THEN
    RAISE EXCEPTION 'Amounts must be positive, <= 9999999999.99 and have at most two decimals';
  END IF;
END $$;
ALTER TABLE "Transaction" ALTER COLUMN "amount" TYPE DECIMAL(16,2) USING "amount"::numeric;
ALTER TABLE "Transaction" ADD COLUMN "merchantId" TEXT;
CREATE INDEX "Transaction_merchantId_createdAt_idx" ON "Transaction"("merchantId", "createdAt");
