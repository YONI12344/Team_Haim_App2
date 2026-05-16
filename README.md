# Team Haim App

Next.js + TypeScript application for the Team Haim running club, backed by
Firebase (Auth, Firestore, Realtime Database, and Storage).

There are two roles:

- **Coach** — the single account `info.teamhaim@gmail.com` (enforced through
  `lib/constants.ts` → `isCoachEmail` and mirrored in `firestore.rules` /
  `storage.rules`). Manages athletes, workouts, assignments, and journeys.
- **Athletes** — every other signed-in user. They own their profile, log
  workouts, chat with the coach, and read their Season Journey.

## Running locally

```bash
npm install        # or pnpm install
npm run dev        # next dev
npm run build      # production build
npm run lint       # next lint
```

Cloud Functions live under `functions/` and are validated with
`npm --prefix functions run build`.

The pace-zone module has runtime tests (no extra dev-deps required):

```bash
npx --yes tsx lib/__tests__/running.test.mjs
```

## Athlete profile fields

`AthleteProfile` lives at `users/{uid}` in Firestore and now includes:

- `name`, `dateOfBirth`, `gender` (Male / Female / Other dropdown)
- `height` (cm), `weight` (kg), `photoURL` (uploaded to Firebase Storage at
  `profilePhotos/{uid}.<ext>`)
- `discipline[]` — Track & Field, Distance / Road, Jogger, Trail, Mixed
- `events[]` — comma-separated chips (e.g. `5K`, `Half Marathon`, `1500m`)
- `experienceLevel` — Beginner / Intermediate / Advanced / Professional
- `weeklyMileage` (km / week)
- `restingHR`, `maxHR` (bpm) — used for heart-rate zone calculations
- `goalRaceEvent`, `goalRaceDate`, `goalRaceTarget` — surfaced on the
  profile card and on the Season Journey page
- `personalRecords[]`, `seasonBests[]`, `trainingPaces[]`, `goals[]` —
  arrays the athlete can manage inline; coach can edit too

Every athlete can fully self-service their own document; the coach can edit
any athlete's document.

## Training zones (`lib/running.ts`)

We compute pace and heart-rate zones from the athlete's most recent
supported race PR. The model follows Jack Daniels' VDOT framework
(*Daniels' Running Formula*, 4th ed.):

1. **Cost of running** at velocity `v` (m/min):
   `VO2(v) = -4.60 + 0.182258·v + 0.000104·v²`
2. **Sustainable fraction of VO2max** for a `t`-minute race:
   `%VO2max(t) = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)`
3. **VDOT** = `VO2(v_race) / %VO2max(t_race)`
4. Each training zone has a target %VO2max:
   - Easy / Long: 65–74 %
   - Marathon (M): ~84 %
   - Threshold lower (T1): ~86 %
   - Threshold (T): ~88 %
   - Threshold upper (T2): ~90 %
   - Interval (I): ~98 %
   - Repetition (R): ~105 %

   We invert the cost equation to get the velocity (and therefore pace)
   matching each anchor.

HR zones use the Karvonen reserve formula when resting HR is known:
`zone = resting + pct × (max − resting)`. Otherwise we fall back to a
straightforward %max HR scale. Tanaka (`208 − 0.7·age`) is provided to
estimate max HR.

The Training Zones card is visible on the athlete profile and on the coach
athlete-detail page; the coach view also exposes a *How is this calculated?*
panel.

## Season Journey

A *Season Journey* is the road from today to a goal race, broken into
training stages (Base → Build → Peak → Taper → Race Week, plus optional
Recovery / Custom blocks). Journeys live in a subcollection at
`users/{athleteId}/journey/{journeyId}` and contain:

- Title, goal race event / date / target time, start date
- `stages[]` of `JourneyStage` (id, name, type, start/end dates, focus,
  weekly volume, key workouts, milestones, notes)

Routes:

- `/athlete/journey` — read-only timeline with a hero card (days-to-race,
  overall progress, currently-active stage) and a vertical stage timeline
  ending in a coral "Goal race" marker.
- `/coach/athletes/[id]/journey` — same timeline plus inline edit controls:
  add / remove / reorder stages, edit goal-race metadata, and a one-click
  template generator with three starter plans (16-week Marathon, 12-week
  10K, 8-week 5K).

## Theme

The palette is navy + gold with a fun soft-coral accent used sparingly for
PRs, streaks, and the goal race marker. CSS tokens live in
`app/globals.css` under `:root` / `.dark`:

- `--navy`, `--navy-light`, `--navy-tint`
- `--gold`, `--gold-light`
- `--coral`, `--coral-light`

Body copy uses Inter / system-ui at `font-normal`; headings default to
`font-semibold` sans-serif. The decorative Playfair serif is reserved for
hero titles via the `font-serif` utility on a per-element basis. Cards
default to `rounded-2xl` with softer shadows.

## Security rules

- `firestore.rules` — athletes read/write their own `users/{uid}` doc and
  `users/{uid}/journey/*` subcollection; the coach (matched by email)
  reads/writes everything; workouts and assigned workouts are coach-write,
  signed-in-read.
- `storage.rules` — athletes may write only `profilePhotos/{uid}.<ext>`
  (≤ 5 MB, must be an image); coach can manage any profile photo;
  signed-in users may read.

Deploy with `firebase deploy --only firestore:rules,storage`.
