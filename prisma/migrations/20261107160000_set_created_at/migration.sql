-- Sets had no order. Existing rows all get the time of this migration, since
-- their real order was never recorded.
ALTER TABLE "Set" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
