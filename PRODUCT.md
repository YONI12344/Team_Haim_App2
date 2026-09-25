# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Next.js app, also shipped to iOS/Android through a Capacitor wrapper. The design language is web, used mostly on phones.)

## Users

- **Coach (one account):** Haim / Team Haim. Plans training, manages athletes, reads their logs, and talks to them. Works from phone and desktop.
- **Athletes:** online coaching clients. Every athlete is coached remotely. The group is mixed: mostly recreational joggers and road runners who open the app on their phone before or after a run, plus competitive track/road racers training toward specific races who use the data heavily.

## Product Purpose

Team Haim is the coach's platform for remote coaching. The coach delivers the training plan, and athletes follow it, log what they did, and stay in conversation with the coach. Success means athletes feel coached personally even though the relationship is fully online, and the coach can keep up with every athlete without drowning in admin.

## Positioning

A personal coach's own platform, not a generic training app. Plans, pace zones, and feedback come from Haim's own methods, and the coach-athlete relationship is the center of the product.

## Operating Context

- Athletes: check today's workout, run, log it (or sync from Strava), check progress, message the coach.
- Coach: review athletes, build and assign workouts and plans (Planning Hub), chat 1:1 (`/coach/chat/[athleteId]`), handle leads/applications (`/apply`, `/coach/leads`).
- Daily morning/evening reminders and push notifications keep athletes on track.

## Capabilities and Constraints

- Roles: a single coach account (`isCoachEmail` in `lib/constants.ts`, mirrored in Firestore/Storage rules); every other signed-in user is an athlete.
- Stack: Next.js + TypeScript, Firebase (Auth, Firestore, Realtime DB, Storage), Cloud Functions, Capacitor.
- Athlete features: schedule, routine, lift, journey (Season Journey), progress, stats, lab, documents, profile, onboarding, chat.
- Integrations: Strava sync. An AI coach built on a new brain is planned as its own page later; the previous AI coach was removed.
- Training zones follow Jack Daniels' VDOT model (`lib/running.ts`).
- Bilingual: English and Hebrew (RTL). Which language is primary is **undecided**; both must work.
- **The app is live at app.teamhaim.com.** All improvement work happens locally and is verified locally; nothing is deployed without the coach's explicit go-ahead.
- **Undecided:** the exact form of the coach↔athlete communication core (1:1 chat, AI coach in the coach's voice, team broadcasts, per-workout feedback). The coach wants the platform to be where they talk to their athletes, and all four are candidates.

## Brand Commitments

- Name: Team Haim. TH monogram logo (`public/team-haim-logo.png`; replacement pending per `LOGO_TODO.md`).

## Evidence on Hand

- Real athlete data lives in production Firestore. There are no testimonials, press, or public metrics in the repo, and future work must not invent them.

## Product Principles

1. The coach relationship comes first: every screen should make athletes feel personally coached.
2. Phone-first: most use is quick glances on a phone around a run.
3. Serve both ends: simple for joggers, deep data for racers, without either getting in the other's way.
4. Scale the coach: the coach's time is the bottleneck, so tools should cut admin, not add to it.
5. Don't break what's live: improvements must preserve existing data and behavior for current athletes.

## Accessibility & Inclusion

Full RTL support for Hebrew alongside LTR English.
