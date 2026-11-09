# UI polish

The README asks: _"the UI is very basic. Show us how you'd make it look clean and professional."_

This was done in three passes, each its own pull request: a visual redesign of every page ([#11](https://github.com/makis-san/demo-project/pull/11)), an interaction design for each screen ([#12](https://github.com/makis-san/demo-project/pull/12)), and a phone-first review of the whole app ([#19](https://github.com/makis-san/demo-project/pull/19)). The workflow of the app did not change: you still start a workout, log sets, finish it, and read your history. What changed is how it looks and how many taps each step takes.

## 1. The look

The goal was a design that looks made for this product, not a template.

- **A dark stage.** Gyms are dim and a phone is read at arm's length, so the app has one dark theme instead of two half-done ones. The background has faint ruled lines, like a training log.
- **One brand colour, one complement.** The brand red (`#dd2729`, the original `#cc2d00` made a little brighter for a dark screen) is for what you can press and for personal records. Teal (`#57d4d4`), its complement on the colour wheel, means "go" and "done": rest is over, a workout is saved, a gain since the first entry. A lighter red (`#fa7f8c`) is used for red text, because plain red on the dark ground was only about 4:1. Every pair was checked with a script (OKLCH to sRGB, WCAG ratio), not by eye: white on the red is 4.8:1 and the text red is 7.9:1.
- **One font.** Archivo. Its width axis gives wide headings and normal body text from one file. Every number uses tabular figures, so columns of weights line up.
- **Glass only where something sits behind it.** The sidebar, the dock and the cards are frosted. Rows inside them are a flat translucent fill, because blurring many elements is slow on phones.
- **Motion that means something.** A page fades up once when it opens, buttons step up on hover and press down on tap, and numbers roll when they change (stats, clocks, counts, using [torph](https://www.npmjs.com/package/torph)). Nothing moves on scroll. With "reduce motion" on, the countdown and the confetti are skipped, and the page, ring and movement figure animations stop.

The first version of this look still had a template feel: every screen had an uppercase label over its title, a red glow behind it, and the same stat grid (the label style was used in 51 places). The phone review removed those. Titles are normal-case headings, small labels are kept only where they name a value (a status like "This device"), and each screen shows its numbers its own way.

## 2. One idea per screen

Each screen was designed around the one thing you do there.

| Screen          | Idea      | What that means                                                                                                                                   |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home            | Today     | A greeting, then Start (or today's planned workout, or Resume), this week as seven days, the last session in one line, and the latest body weight |
| Current workout | Focus     | A ring that shows the session live: one arc per movement, pauses, and a ghost of the plan. The weight and reps form is built for one thumb        |
| Workout history | Journal   | An 18-week training calendar, then the workouts as a list grouped by week, and the progression chart                                              |
| Movements       | Catalogue | Search first, body-part tabs, cards with a figure of the muscles, and the rest of the filters behind one button                                   |
| Body weight     | Scale     | The number is the hero, the chart under it, the log as one line per entry                                                                         |
| Workout library | Plans     | Each workout card shows its days as M T W T F S S                                                                                                 |

## 3. Phone first

The app is used at the gym, on a phone, often with one hand and between sets. I went through every screen at 390 × 844 with 8 weeks of training data. The main finding was that the thing you do most was never where your thumb is.

| Problem                                                                             | Change                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The dock had seven items, including Log out next to Weight                          | Five items: Home, Library, Workout (raised, in the middle), History, Weight. Movements and the workout library are one Library item with a switch at the top. Log out and the Account page are in a round menu on Home |
| During a workout the set form was below the fold, so every set needed a scroll      | **Focus mode**: the dock hides while a workout runs. A top bar has Minimize, the clock and Finish. Weight, reps and Add sit in a bar at the bottom                                                                     |
| The ring was small, but the phone is often on a bench or the floor                  | The ring is as wide as the screen, with the clock and the movement large enough to read from a distance                                                                                                                |
| Weight and reps started empty, though the screen already showed the last top set    | Filled in for you: this session's last set of that movement, then the plan's next set, then the last top set from earlier workouts. A body-weight movement starts from the latest body weight, as the README asks      |
| While resting, the timer took space and the ring shrank                             | −15s, +15s and Skip take the place of the normal controls under the ring, which keeps its size                                                                                                                         |
| History was a desktop table with a column cut off                                   | A list of workouts grouped by week. Checkboxes appear only after tapping Select                                                                                                                                        |
| The filters filled the first screen of Movements                                    | Search and body-part tabs stay. The rest is in one Filters sheet                                                                                                                                                       |
| Body-weight entries wrapped onto two lines, with edit and delete icons on every row | One line per entry. Tap a row to edit it, and delete from inside the edit                                                                                                                                              |

Desktop keeps the sidebar with every page and the wider layouts.

## 4. Small things that make it feel finished

- **Set dials.** Large numbers with − and + buttons. Hold to keep stepping, faster after a moment. Weight steps by 5, reps by 1.
- **Rest timer.** Starts on its own after every set, with a ring and the seconds counting down. The phone buzzes when it ends. The length is remembered.
- **Personal records.** A PR badge marks a set heavier than the movement's best. The movement card shows the last top set and the best.
- **Start screen and countdown.** A workout shows its plan first and begins only after Start and a 3, 2, 1, GO, so nothing starts by accident.
- **Finish.** A recap of the session with confetti.
- **Haptics.** A short buzz on Add, and a double buzz when rest ends and when a workout is done, on phones that support it.

## 5. How it was checked

- **Screens.** Screenshots of every page at 390 × 844, 375 × 667, 320 × 640 and 1280 wide, with a seeded user and 8 weeks of history, compared before and after each change.
- **End-to-end tests.** The phone layout is part of the suite: no page scrolls sideways at 390px, the dock has five items with the workout in the middle, focus mode hides the dock, the fields are prefilled, and the rest controls appear under the ring. The suite runs in CI on every pull request.
- **A bug found late.** The ring was off-centre on windows between 640 and 767px wide. It was sized from the viewport (`100vw`), and at those widths its card has padding, so it came out 48px wider than its column. It is now sized from its column, and is centred at 320, 375, 390 and 649px.

## 6. Not done, and why

- **A light theme.** One theme done well was worth more than two done halfway. The colours are tokens, so one can be added later.
- **An automated accessibility check.** Contrast was checked by script and the pages use proper names and roles, which the tests depend on, but no tool like axe runs in CI yet. It is the next step.
- **A loading bar between pages.** Pages are rendered on the server with their data, so only client-side navigation waits. On a slow connection nothing shows that a page is loading.
- **Two workouts on one day** overlap on a long progression chart, and the toast says the browser's "Failed to fetch" when the network is down. Both are small and known.
