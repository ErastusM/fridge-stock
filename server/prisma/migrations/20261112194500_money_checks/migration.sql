-- Money can be zero but never negative; a payment is always a positive amount (a correction is a CREDIT).
ALTER TABLE "Item" ADD CONSTRAINT "Item_price_nonnegative" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_money_nonnegative" CHECK (("unitPriceCents" IS NULL OR "unitPriceCents" >= 0) AND ("amountCents" IS NULL OR "amountCents" >= 0));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCents" > 0);
-- 1..28 so every month has the day.
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_statement_day" CHECK ("statementStartDay" BETWEEN 1 AND 28);
