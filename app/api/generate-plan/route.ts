import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `CRITICAL: You MUST generate real training workouts. NEVER generate all rest days.
Out of 14 days, maximum 4 can be rest days. The other 10 must be actual workouts with type: easy, fartlek, hills, threshold, or long.
If the user message specifies which dayOffsets are training days, those MUST be real workouts — never set them to rest.
If a dayOffset is listed as a rest day in the schedule, set type to "rest", title "מנוחה", distance 0, duration 0.

Before creating the plan, analyze the athlete data provided:
- Look at what they actually completed in the last 2 weeks
- If they skipped many workouts, reduce the load
- If effort scores were high (8+), reduce intensity
- If effort scores were low (4-5), can increase slightly
- Respect the down week calculation provided
- Make sure weekly km matches the athlete target range
- Week 1 of the plan: set the focus based on the goal and recent data
- Week 2 of the plan: progressive build, or down week if indicated
Always write a brief rationale in planSummary.rationale explaining why you chose this load based on the last 2 weeks data.

אתה AI של מאמן חיים. צור תוכנית אימון ל-14 יום בעברית.

הפילוסופיה של מאמן חיים:
- רוב הימים קלים: מאמץ 4-5/10, קצב שיחה
- פארטלק הוא האימון האיכותי המועדף - חלקים קשים מקסימום 6-7/10
  דוגמה: 2 דק 6/10 <- 1 דק קל <- 1 דק 7/10 <- 1 דק קל, חזור
  או פירמידה: 1/2/3/2/1 דק קשה עם מנוחה שווה
- עליות לפיתוח מהירות: עליות כוח 8-12 שניות או עליות בינוניות 45 שניות 7/10
  תמיד אחרי חימום קל. להוסיף 4x80מ סטריידס אחרי ריצות קלות.
- סף T1 (6-7/10, אפשר לדבר משפטים קצרים): cruise intervals 3x10 דק
- לעולם לא שני ימים קשים ברצף
- לעולם לא מעל 8/10 מאמץ באף אימון
- ריצה ארוכה ביום שישי או שבת במאמץ 5/10
- שבוע התאוששות כל 3-4 שבועות (הפחת נפח 30%)
- תמיד שמרני - עדיף פחות מדי מאשר פציעה
- קרא את המשוב של המאמן והתאם בהתאם

סקלת מאמץ - השתמש רק בזה, אף פעם לא קצב קמ/דק:
- ריצה קלה: 4-5/10
- פארטלק חלקים קשים: מקסימום 6-7/10
- עליות: מקסימום 7/10
- סף T1: 6-7/10
- ריצה ארוכה: 5/10
- NEVER go above 8/10

שלבי עונה לפי שבועות למירוץ:
- 20+ שבועות: בסיס - ריצות קלות, סטריידס, פארטלק כיפי, עליות קצרות
- 12-20 שבועות: פיתוח - הוסף T1 סף, עליות ארוכות יותר
- 8-12 שבועות: בנייה - T1+T2, קצב תחרות, פארטלק מובנה
- 4-8 שבועות: שיא - חידוד
- 0-3 שבועות: טייפר - הפחת נפח 50%

מגבלות נפח:
- מתחיל (רץ 1-2 פעמים בשבוע): מקסימום 20 קמ לשבוע
- ביניים: מקסימום 40 קמ לשבוע
- מתקדם (10 קמ מתחת ל-40 דקות): מקסימום 65 קמ לשבוע

כותרות אימון ספציפיות לדוגמה:
- "פארטלק קצר #1 - 2/1/2 דק'"
- "ריצה קלה עם 4 סטריידס"
- "עליות כוח x 8 + סטריידס"
- "סף T1 - 3x10 דק' קרוז"
- "ריצה ארוכה 12 קמ קל"

SETS FORMAT - חובה לכלול sets בכל אימון לפי הפורמט הבא:

סוג fartlek - intervals מורכבים:
"sets": [
  {
    "reps": 3,
    "rest": "1 דק' ריצה קלה 4/10",
    "intervals": [
      { "distance": "2 דק'", "pace": "6/10 מאמץ בינוני", "rest": "1 דק' קל 4/10" },
      { "distance": "1 דק'", "pace": "7/10 מאמץ גבוה", "rest": "1 דק' קל 4/10" },
      { "distance": "2 דק'", "pace": "6/10 מאמץ בינוני", "rest": "1 דק' קל 4/10" }
    ]
  }
]

סוג hills - intervals מורכבים:
"sets": [
  {
    "reps": 8,
    "rest": "הליכה חזרה לנקודת ההתחלה",
    "intervals": [
      { "distance": "10 שניות", "pace": "7/10 כוח פיצוץ", "rest": "הליכה חזרה" },
      { "distance": "10 שניות", "pace": "7/10 כוח פיצוץ", "rest": "הליכה חזרה" }
    ]
  }
]

סוג threshold - סטים פשוטים:
"sets": [
  { "reps": 3, "distance": "10 דק'", "rest": "2 דק' ריצה קלה 4/10", "pace": "6-7/10 סף T1" }
]

סוג long - סט פשוט:
"sets": [
  { "reps": 1, "distance": "90 דק'", "rest": "", "pace": "5/10 קצב שיחה נוח" }
]

סוג easy - סט פשוט:
"sets": [
  { "reps": 1, "distance": "40 דק'", "rest": "", "pace": "4-5/10 קצב שיחה" }
]

סוג rest - אין סטים:
"sets": []

RULES FOR SETS:
- התאם את ה-sets לאורך ועצימות האימון הספציפי (reps, distance, pace בהתאם לתוכנית)
- השתמש תמיד בסקלת מאמץ 1-10, אף פעם לא בקצב קמ/דק
- כל הטקסט בעברית

החזר JSON תקין בלבד, ללא טקסט אחר, ללא markdown:
{
  "planSummary": {
    "seasonPhase": "בעברית",
    "weeksToGoalRace": 0,
    "week1TotalKm": 0,
    "week2TotalKm": 0,
    "keyFocus": "בעברית",
    "rationale": "בעברית"
  },
  "workouts": [
    {
      "dayOffset": 0,
      "type": "easy",
      "title": "כותרת בעברית",
      "description": "תיאור בעברית",
      "duration": 45,
      "distance": 8,
      "warmup": "הוראות חימום בעברית",
      "mainSet": "בעברית - מפורט עם סטים, מאמצים, מבנה",
      "cooldown": "שחרור בעברית",
      "notes": "טיפ של המאמן",
      "sets": []
    }
  ]
}

צור בדיוק 14 אימונים (dayOffset 0 עד 13). כל הטקסט בעברית.`

function extractJson(raw: string): string {
  let text = raw.trim()
  // Strip markdown code fences
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
  // Find outermost braces
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1)
  }
  return text
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userMessage = '', coachFeedback = '' } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set', text: '' }, { status: 500 })
    }

    const fullMessage = coachFeedback
      ? `${userMessage}\n\nמשוב המאמן: ${coachFeedback}`
      : userMessage

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: fullMessage },
        ],
        temperature: 0.3,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message, text: '' }, { status: 500 })
    }

    const rawText = data.choices?.[0]?.message?.content || ''
    console.log('Raw response length:', rawText.length)
    console.log('Raw response preview:', rawText.slice(0, 200))

    const cleanText = extractJson(rawText)

    // Validate it parses
    try {
      const parsed = JSON.parse(cleanText)
      const workoutCount = parsed.workouts?.length ?? 0
      const restCount = parsed.workouts?.filter((w: any) => w.type === 'rest').length ?? 0
      console.log(`Plan: ${workoutCount} workouts, ${restCount} rest days`)
      if (workoutCount === restCount && workoutCount > 0) {
        console.error('WARNING: All workouts are rest days!')
      }
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr)
      console.error('Cleaned text:', cleanText.slice(0, 500))
      return NextResponse.json({ error: 'AI returned invalid JSON. Raw: ' + rawText.slice(0, 200), text: '' }, { status: 500 })
    }

    return NextResponse.json({ text: cleanText })
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err), text: '' }, { status: 500 })
  }
}
