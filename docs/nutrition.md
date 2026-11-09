# Nutrition

The README asks: _"how would you add nutrition tracking? Consider macros (carbs, protein, fat), calories, and a calorie surplus or deficit."_

This is a design, not a feature that was built. It says what the user would do, how the data would be stored and why, how the surplus or deficit is worked out, and what a first version would include. It builds on what Setlist already has: the user's own timezone for days, the body-weight log, and the chart on the history page.

## 1. What the user does

1. **Logs what they ate**: a name, calories, and protein, carbs and fat in grams. A food they logged before is one tap, from a list of recent entries.
2. **Sets a daily calorie target**, and macro targets if they want them.
3. **Sees today against the target**: what they've eaten, what's left, and the surplus or deficit.
4. **Sees the trend**: daily calories against the target for the last 30 days, with body weight on the same dates. Setlist already logs body weight, so it can answer the question people actually have: if I'm eating at a deficit, is my weight going down?

## 2. Data model

| Table           | Columns                                                                                                        | Why                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FoodEntry`     | `id`, `userId`, `eatenAt` (timestamp), `name`, `calories` (int), `proteinG`, `carbsG`, `fatG` (`Decimal(6,1)`) | One row per thing eaten. Calories are stored, not worked out from the macros. Labels round, and alcohol (7 kcal/g) and fibre don't fit 4/4/9, so a computed value would disagree with the label the user is reading. A big mismatch is a warning in the form, not an error |
| `NutritionGoal` | `id`, `userId`, `calories`, optional `proteinG`, `carbsG`, `fatG`, `effectiveFrom` (date)                      | A history of targets, not one column on the user. Last month's deficit has to be measured against last month's target, or changing the goal today would rewrite the past                                                                                                   |
| Later: `Food`   | `id`, `userId`, `name`, values per serving                                                                     | Saved foods. The first version doesn't need it: "recent foods" comes from `FoodEntry`                                                                                                                                                                                      |

- **Indexes**: `FoodEntry(userId, eatenAt)` for a day's entries and for recent foods, and `NutritionGoal(userId, effectiveFrom)` for the target in force on a day.
- **CHECK constraints** for non-negative calories and macros, the way the schema already guards the rest range and the weekday of a planned workout. Prisma can't express them, so they go in the migration by hand.
- **Owner checks** on every server function, through `authMiddleware`, with input validated by zod, like the rest of `src/lib/*.server.ts`.
- **Account deletion**: the foreign keys to `User` are `RESTRICT` on purpose, and `deleteUserAndData` in [`account.server.ts`](../src/lib/account.server.ts) deletes each kind of row explicitly. The new tables go into that function, or deleting an account would fail.

## 3. Days, and the surplus or deficit

- **A day is the user's day.** Entries are grouped in SQL by `eatenAt` converted to the browser's timezone, the same way the progression chart groups workouts ([`progression.server.ts`](../src/lib/progression.server.ts)). A snack at 11:30 pm counts towards that day, not the next one in UTC.
- **Surplus or deficit for a day = calories eaten − the target in force that day.** The target is the latest `NutritionGoal` whose `effectiveFrom` is on or before that day, found with a lateral join, so a range of days is still one query.
- **A day with no entries is "not logged"**, not a 100% deficit. Averages only count logged days, so one forgotten day doesn't make the week look like a crash diet.

## 4. Where the target comes from

| Option                                | For                                                                                                                                                                                                 | Against                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **The user types it** (first version) | No extra personal data, no formula to defend                                                                                                                                                        | The user has to know their number                                                  |
| Mifflin-St Jeor × an activity factor  | The standard estimate                                                                                                                                                                               | Needs height, age, sex and activity level: more personal data to store and protect |
| Adaptive, from the user's own data    | The most accurate. Weight trend plus logged intake over 2 to 4 weeks gives real expenditure: about 3,500 kcal per lb of body weight (7,700 per kg). It uses the body-weight log Setlist already has | Needs weeks of consistent logging before it says anything useful                   |

The first version uses the typed target. The adaptive estimate is the one that would make Setlist's nutrition better than a generic food log, because it's the one that uses data only Setlist has.

## 5. A first version

- A migration for `FoodEntry` and `NutritionGoal`, with the indexes and CHECK constraints above.
- Server functions: add, edit and delete an entry, list a day, set a goal, and get the daily summary for a range of days.
- A **Nutrition** page: today's entries, an add form with recent foods, totals against the target, and the surplus or deficit.
- A 30-day chart: calories as points, the target as a line, body weight on a second axis. [`line-chart.tsx`](../src/components/ui/line-chart.tsx) takes one series today, so it needs a second series and a second axis. That's the part most likely to grow.
- An entry in the sidebar and in the phone dock.
- e2e tests: add, edit and delete an entry, a day's totals and deficit, a goal change that leaves past days alone, an entry near midnight counted on the user's day, another user unable to read the entries, and account deletion removing them.

**Left out of the first version:** a food database or barcode scanning, macro targets on the chart, meals, the Mifflin-St Jeor estimate, and the adaptive estimate.
