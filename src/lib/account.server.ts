import type { PrismaClient } from "../../prisma/generated/client/client";

/** How many rows of each kind `deleteUserAndData` removed. Sets, preset exercises and the rest go with their parent. */
export type DeletedCounts = {
  sessions: number;
  workouts: number;
  bodyWeights: number;
  presets: number;
  movements: number;
};

/**
 * Deletes a user and everything of theirs, in one transaction: either all of it goes or none of it does.
 *
 * The foreign keys from User are RESTRICT on purpose, so a stray DELETE of a user fails instead of silently
 * deleting their history. That means this is the one place that knows the order, children before parents:
 *
 * 1. sessions, which signs every browser out
 * 2. workouts. Their sets go with them (ON DELETE CASCADE), and so do the "repeat of" links between them
 * 3. body weights
 * 4. presets. Their exercises, series and weekdays go with them. Done after the workouts, whose `presetId` pointed here
 * 5. custom movements, once nothing points at them: their sets went in step 2 and their presets in step 4. A built-in
 *    has no `userId`, so it is never touched
 * 6. the user
 *
 * If a table is ever added that points at User, the last step fails on the foreign key and rolls back everything,
 * so the new table shows up as an error here, not as rows left behind.
 *
 * It takes the client so a script can pass one built from an explicit database URL, and the app can pass its own.
 * It does not check who is asking: whoever calls it must already have decided that this user may be deleted.
 */
export async function deleteUserAndData(prisma: PrismaClient, userId: string): Promise<DeletedCounts> {
  return prisma.$transaction(async (tx) => {
    const sessions = await tx.session.deleteMany({ where: { userId } });
    const workouts = await tx.workout.deleteMany({ where: { userId } });
    const bodyWeights = await tx.bodyWeight.deleteMany({ where: { userId } });
    const presets = await tx.workoutPreset.deleteMany({ where: { userId } });
    const movements = await tx.movement.deleteMany({ where: { userId } });
    // delete, not deleteMany: an id that does not exist throws, and the transaction rolls back.
    await tx.user.delete({ where: { id: userId } });
    return {
      sessions: sessions.count,
      workouts: workouts.count,
      bodyWeights: bodyWeights.count,
      presets: presets.count,
      movements: movements.count,
    };
  });
}
