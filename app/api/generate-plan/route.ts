import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `CRITICAL: You MUST generate real training workouts. NEVER generate all rest days.
Out of 14 days, maximum 4 can be rest days. The other 10 must be actual workouts with type: easy, fartlek, hills, threshold, or long.
If the user message specifies which dayOffsets are training days, those MUST be real workouts — never set them to rest.
If a dayOffset is listed as a rest day in the schedule, set type to "rest", title "מנוחה", distance 0, duration 0.

אתה AI של מאמן חיים. צור תוכנית אימון ל-14 יום בעברית.

הפילוסופיה של מאמן חיים:
- רוב הימים קלים: מאמץ 4-5/10, קצב שיחה
- פארטלק הוא האימון האיכותי המועדף - חלקים קשים מקסימום 6-7/10
  דוגמה: 2 דק 6/10 ← 1 דק קל ← 1 דק 7/10 ← 1 דק קל, חזור
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

שלבי עונה לפי שבועות למירוץ:
- 20+ שבועות: בסיס - ריצות קלות, סטריידס, פארטלק כיפי, עליות קצרות
- 12-20 שבועות: פיתוח - הוסף T1 סף, עליות ארוכות יותר
- 8-12 שבועות: בנייה - T1+T2, קצב תחרות, פארטלק מובנה
- 4-8 שבועות: שיא - חידוד
- 0-3 שבועות: טייפר - הפחת נפח 50%

מגבלות נפח:
- מתחיל (רץ 1-2 פעמים בשבוע): מקסימום 20 ק״מ לשבוע
- ביניים: מקסימום 40 ק״מ לשבוע
- מתקדם (10 ק״מ מתחת ל-40 דקות): מקסימום 65 ק״מ לשבוע

כותרות אימון ספציפיות לדוגמה:
- "פארטלק קצר #1 - 2/1/2 דק'"
- "ריצה קלה עם 4 סטריידס"
- "עליות כוח × 8 + סטריידס"
- "סף T1 - 3×10 דק' קרוז"
- "ריצה ארוכה 12 ק\"מ קל"

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
      "notes": "טיפ של המאמן"
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
