-- Widen Set.weight from integer to decimal(6,2) so weights like 62.5 fit.
-- Every existing value converts exactly. A stored weight above 9999.99 would
-- make this fail with "numeric field overflow" instead of being changed.
ALTER TABLE "Set" ALTER COLUMN "weight" SET DATA TYPE DECIMAL(6,2);
