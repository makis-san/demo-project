-- Rename only. Rows created before this migration still hold plaintext
-- passwords until `bun run db:hash-passwords` is run once, which replaces them
-- with argon2id hashes. Sign-in refuses any value that is not a valid hash.
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";
