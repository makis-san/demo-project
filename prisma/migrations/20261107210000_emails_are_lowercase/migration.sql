-- Emails are now trimmed and lowercased before they are stored, so the unique
-- index on "email" also covers case. Existing rows have to follow.
--
-- Two accounts that differ only by case cannot be merged automatically, because
-- it is not clear which one is the real one or whose data to keep. If there are
-- any, stop and list them so someone can decide.
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(address || ' (' || accounts || ' accounts)', ', ')
  INTO clashes
  FROM (
    SELECT lower(btrim(email)) AS address, count(*) AS accounts
    FROM "User"
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) AS duplicates;

  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lowercase emails, these addresses belong to more than one account: %. Merge or remove the extra accounts, then run the migration again.', clashes;
  END IF;
END $$;

UPDATE "User" SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

-- The code normalizes emails, this makes the database refuse anything else.
-- Prisma has no way to express a CHECK constraint and leaves it alone.
ALTER TABLE "User" ADD CONSTRAINT "User_email_is_normalized" CHECK (email = lower(btrim(email)));
