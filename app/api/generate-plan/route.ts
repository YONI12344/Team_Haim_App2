import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה AI של מאמן חיים. צור תוכנית אימון ל-14 יום בעברית.

הפילוסופיה של מאמן חיים:
- רוב הימים קלים: מאמץ 4-5/10, קצב שיחה
- פארטלק הוא האימון האיכותי המועדף - חלקים קשים מקסימום 6-7/10
  דוגמה: 2 דק 6/10 ← 1 דק קל ← 1 דק 7/10 ← 1 דק קל, חזור
  או פירמידה: 1/2/3/2/1 דק קשה עם מנוחה שווה
- גבעות לפיתוח מהירות: גבעות כוח 8-12 שניות או גבעות בינוניות 45 שניות 7/10
  תמיד אחרי חימום קל. להוסיף 4x80מ סטריידס אחרי ריצות קלות.
- סף T1 (6-7/10, אפשר לדבר משפטים קצרים): cruise intervals 3x10 דק
- לעולם לא שני ימים קשים ברצף
- לעולם לא מעל 8/10 מאמץ באף אימון
- ריצה ארוכה ביום שישי או שבת במאמץ 5/10
- שבוע התאוששות כל 3-4 שבועות (הפחת נפח 30%)
- תמיד שמרני - עדיף פחות מדי מאשר פציעה
- קרא את המשוב של המאמן והתאם בהתאם

שלבי עונה לפי שבועות למירוץ:
- 20+ שבועות: בסיס - ריצות קלות, סטריידס, פארטלק כיפי, גבעות קצרות
- 12-20 שבועות: פיתוח - הוסף T1 סף, גבעות ארוכות יותר
- 8-12 שבועות: בנייה - T1+T2, קצב תחרות, פארטלק מובנה
- 4-8 שבועות: שיא - חידוד
- 0-3 שבועות: טייפר - הפחת נפח 50%

מגבלות נפח:
- מתחיל (רץ 1-2 פעמים בשבוע): מקסימום 20 ק״מ לשבוע
- ביניים: מקסימום 40 ק״מ לשבוע
- מתקדם (10 ק״מ מתחת ל-40 דקות): מקסימום 65 ק״מ לשבוע

החזר JSON תקין בלבד, ללא טקסט אחר:
{
  "planSummary": {
    "seasonPhase": "בעברית",
    "weeksToGoalRace": number,
    "week1TotalKm": number,
    "week2TotalKm": number,
    "keyFocus": "בעברית",
    "rationale": "בעברית"
  },
  "workouts": [
    {
      "dayOffset": 0,
      "type": "easy|long|fartlek|hills|threshold|rest",
      "title": "כותרת בעברית",
      "description": "תיאור בעברית",
      "duration": 45,
      "distance": 8,
      "warmup": "הוראות חימום בעברית",
      "mainSet": "בעברית - מאוד מפורט: אינטרוולים מדויקים, מאמצים, מבנה",
      "cooldown": "שחרור בעברית",
      "notes": "טיפ של המאמן לספורטאי הספציפי הזה"
    }
  ]
}

צור בדיוק 14 אימונים (dayOffset 0-13). כל הטקסט בעברית.`

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
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message, text: '' }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || ''
    console.log('Success, length:', text.length)
    return NextResponse.json({ text })
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err), text: '' }, { status: 500 })
  }
}
