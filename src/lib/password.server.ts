import { hash, verify } from "@node-rs/argon2";

// Argon2id with 19 MiB of memory, 2 passes and 1 lane. This is one of the
// minimum configurations in the OWASP Password Storage Cheat Sheet. The
// library default algorithm is Argon2id, so only the costs are set here.
const hashOptions = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, hashOptions);
}

/**
 * Returns true only when the password matches the hash. Any error, such as a
 * stored value that is not a valid hash, counts as a failed check.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Verifies against a throwaway hash. Sign-in calls this when the email is
 * unknown, so the response takes as long as for a real account.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummyHash, password);
}
