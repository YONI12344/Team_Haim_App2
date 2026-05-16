# Team Haim Cloud Functions — Google Sheets Auto Sync

These Cloud Functions automatically sync Firestore athlete data to a master
Google Sheet whenever a document is written. Each athlete gets their own tab
named after their display name.

## Functions

| Function | Type | Trigger |
|---|---|---|
| `syncLogToSheets` | Firestore trigger | `logs/{logId}` written |
| `syncWorkoutToSheets` | Firestore trigger | `workouts/{workoutId}` written |
| `syncProfileToSheets` | Firestore trigger | `users/{userId}` written |
| `syncGoalsToSheets` | Firestore trigger | `goals/{goalId}` written |
| `syncAllAthletesNow` | HTTPS Callable | Called from coach settings UI |
| `testSheetsSync` | HTTPS Callable | Testing / debugging |

All Firestore triggers are deployed in `europe-west1` with Eventarc watching
Firestore in `me-west1` (cross-region via Pub/Sub).

---

## Required Environment Variables

Set these in `functions/.env` (this file is git-ignored):

```dotenv
# Google Sheets service account
GOOGLE_SERVICE_ACCOUNT_EMAIL=team-haim-sheets@teamhaim.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Master sheet where all athlete tabs live
MASTER_SHEET_ID=1EDW4R1sIg-491HsXPJx9hNYJR5CVBerUsfBf-8XlFGw

# Service account used by Eventarc to generate OIDC tokens for the cross-region
# Pub/Sub push subscription.  Use the default compute SA of the project:
#   PROJECT_NUMBER-compute@developer.gserviceaccount.com
# Replace PROJECT_NUMBER with your GCP project number (found in Cloud Console).
TRIGGER_SERVICE_ACCOUNT=PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

> **Tip:** Firebase shows `Loaded environment variables from .env.` during
> `firebase deploy --only functions` when the file is found.

---

## Required IAM Roles

### On the Compute Service Account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`)

This is the default Cloud Run / Compute SA used for every function.
Replace `PROJECT_NUMBER` with your GCP project number.

| Role | Why |
|---|---|
| `roles/run.invoker` | Allows Eventarc / Pub/Sub to invoke the Cloud Run service |
| `roles/eventarc.eventReceiver` | Required for 2nd-gen Eventarc triggers |

Grant via gcloud:
```bash
PROJECT=team-haim
SA=PROJECT_NUMBER-compute@developer.gserviceaccount.com  # replace PROJECT_NUMBER

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" --role="roles/run.invoker"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" --role="roles/eventarc.eventReceiver"
```

### On the Cloud Pub/Sub Service Agent (`service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com`)

This SA is used by Pub/Sub to mint OIDC tokens for the cross-region push
subscription.  **This is the most common missing piece for cross-region
Eventarc triggers.**
Replace `PROJECT_NUMBER` with your GCP project number.

| Role | Why |
|---|---|
| `roles/iam.serviceAccountTokenCreator` | Allows Pub/Sub to create OIDC tokens on behalf of the trigger SA, enabling authenticated Cloud Run invocations |

Grant via gcloud:
```bash
PUBSUB_SA=service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com  # replace PROJECT_NUMBER

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$PUBSUB_SA" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Or in Cloud Console:
1. Open **IAM & Admin → IAM** for the `team-haim` project.
2. Tick **Include Google-provided role grants**.
3. Find `service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com`.
4. Add role **Service Account Token Creator**.

---

## Sharing the Master Sheet

1. Open `https://docs.google.com/spreadsheets/d/MASTER_SHEET_ID/edit`
2. Click **Share** (top-right).
3. Add `team-haim-sheets@teamhaim.iam.gserviceaccount.com` as **Editor**.
4. Uncheck "Notify people" → **Share**.

The `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` env vars must match
the key JSON you downloaded for this service account.

---

## How the Sheet ID Is Resolved

`syncAthleteToSheet` resolves the target spreadsheet in this order:

1. `MASTER_SHEET_ID` environment variable (preferred).
2. `settings/googleSheets.sheetId` Firestore document (set via coach settings UI).

If neither is set the sync is skipped with a warning log.

---

## Manually Triggering `syncAllAthletesNow`

### Via the Coach UI

1. Log in as a coach.
2. Go to **Settings** (top-right gear icon or `/coach/settings`).
3. Make sure the **Master Google Sheet ID** field is saved.
4. Click **Sync All Now**.

The button shows a spinner while running and a success / error toast when done.

### Via Firebase Functions Shell

```bash
cd functions
firebase functions:shell
# In the shell:
syncAllAthletesNow({})
```

### Via curl (after getting an auth token)

```bash
TOKEN=$(gcloud auth print-identity-token)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{}}' \
  https://europe-west1-team-haim.cloudfunctions.net/syncAllAthletesNow
```

---

## Verifying End-to-End Sync

1. Deploy functions: `firebase deploy --only functions`
2. Edit any athlete's profile, workout, log, or goal in the app.
3. Wait ~20–30 seconds.
4. Check the master Google Sheet — the athlete's tab should update.
5. Check logs: `firebase functions:log --lines 30`

You should see:
```
[syncAthleteToSheet] start athlete=<uid>
[syncAthleteToSheet] using spreadsheet=1EDW4R...
[syncAthleteToSheet] writing tab="Athlete Name" rows=N
[syncAthleteToSheet] done athlete=<uid> rows=N durationMs=XXXX
Google Sheets sync OK (source=profile, athlete=<uid>)
```

If you see `The request was not authenticated` in the logs, the Pub/Sub SA
is still missing the **Service Account Token Creator** role (see IAM section
above).

---

## Local Development

```bash
cd functions
npm install
npm run build        # compile TypeScript
npm run build:watch  # watch mode
```

The functions directory is a standalone Node.js package — it does **not**
share `node_modules` with the root Next.js app.
