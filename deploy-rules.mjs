// Publishes firestore.rules to the live project via the Firebase Rules API,
// using whatever Application Default Credentials are active (your gcloud
// login, or a real service account in deployment) -- no manual copy/paste
// into the Firebase Console needed. Run with: node deploy-rules.mjs
import { GoogleAuth } from 'google-auth-library'
import { readFileSync } from 'fs'

const PROJECT_ID = 'team-haim'
const rulesContent = readFileSync('./firestore.rules', 'utf8')

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'] })
const client = await auth.getClient()

async function api(method, path, body) {
  const res = await client.request({ url: `https://firebaserules.googleapis.com/v1/${path}`, method, data: body })
  return res.data
}

const ruleset = await api('POST', `projects/${PROJECT_ID}/rulesets`, {
  source: { files: [{ name: 'firestore.rules', content: rulesContent }] },
})
console.log('Created ruleset:', ruleset.name)

const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`
try {
  const updated = await api('PATCH', releaseName, { release: { name: releaseName, rulesetName: ruleset.name } })
  console.log('Updated release:', updated.name, '->', updated.rulesetName)
} catch (err) {
  console.log('PATCH failed, trying to create release instead:', err.message)
  const created = await api('POST', `projects/${PROJECT_ID}/releases`, { name: releaseName, rulesetName: ruleset.name })
  console.log('Created release:', created.name, '->', created.rulesetName)
}

console.log('Done -- rules are live.')
