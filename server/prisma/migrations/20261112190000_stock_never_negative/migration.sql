-- Backstop for the application's per-(fridge, item) lock: a batch can never hold negative stock.
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_qtyRemaining_nonnegative" CHECK ("qtyRemaining" >= 0);
-- An item's thresholds are never negative.
ALTER TABLE "FridgeItem" ADD CONSTRAINT "FridgeItem_thresholds_nonnegative" CHECK ("minQty" >= 0 AND "parLevel" >= 0);
