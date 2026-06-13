import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה עוזר של מאמן ריצה. אתה כותב סיכום שבועי מקצועי בעברית.

הסיכום צריך להיות כמו דוח שבועי אמיתי של מאמן לספורטאי.
כתוב בגוף שני - ישירות לספורטאי.
היה חם, מעודד, ומקצועי.
בסס הכל על הנתונים האמיתיים שקיבלת.

החזר JSON תקין בלבד:
{
  "weekSummary": "סיכום מה קרה השבוע - מה עשה, כמה ק״מ, איך הרגיש. 2-3 משפטים קונקרטיים על מה שקרה בפועל. ציין אימונים ספציפיים שהושלמו או דולגו.",
  "achievements": "הישגים ספציפיים מהשבוע - ציין מספרים אמיתיים כמו ק״מ, מאמץ, עקביות. משפט אחד או שניים חיוביים.",
  "improvements": "נקודה אחת לשיפור בצורה בונה ועידודית. לא ביקורת, אלא כיוון לצמיחה.",
  "nextWeekFocus": "מה מחכה לו שבוע הבא - ציין את סוגי האימונים המתוכננים ומה המטרה שלהם.",
  "coachNote": "הערה אישית חמה מהמאמן - התייחסות אישית לספורטאי הספציפי הזה בהתבסס על מה שעשה השבוע"
}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { athleteName, athleteId, weekStartDate, weekEndDate, weekWorkouts = [], nextWeekWorkouts = [], coachNotes } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    // Aggregate stats from enriched workout objects
    const completed = weekWorkouts.filter((w: any) => w.status === 'completed')
    const skipped = weekWorkouts.filter((w: any) => w.status === 'skipped')
    const totalPlannedKm = weekWorkouts.reduce((s: number, w: any) => s + (w.distance || 0), 0)
    const totalActualKm = weekWorkouts.reduce((s: number, w: any) => s + (w.actualDistance ?? w.distance ?? 0), 0)
    const completedWithEffort = completed.filter((w: any) => w.effort)
    const avgEffort = completedWithEffort.length > 0
      ? (completedWithEffort.reduce((s: number, w: any) => s + w.effort, 0) / completedWithEffort.length).toFixed(1)
      : 'לא דווח'

    // Build per-workout detail lines
    const workoutLines = weekWorkouts.map((w: any) => {
      const statusLabel = w.status === 'completed' ? 'הושלם' : w.status === 'skipped' ? 'דולג' : 'מתוכנן'
      let line = `- ${w.scheduledDate}: ${w.title} (${statusLabel})`
      if (w.status === 'completed') {
        line += ` | ${w.actualDistance ?? w.distance ?? 0} ק״מ`
        line += ` | מאמץ: ${w.effort ?? 'לא דווח'}/10`
        if (w.comment) line += ` | הערת ספורטאי: "${w.comment}"`
      }
      return line
    }).join('\n')

    // Build next-week plan lines
    const nextWeekLines = nextWeekWorkouts.map((w: any) =>
      `- ${w.scheduledDate}: ${w.title} (${w.distance || 0} ק״מ)`
    ).join('\n')

    const userMessage = `ספורטאי: ${athleteName}
שבוע: ${weekStartDate} עד ${weekEndDate}

סיכום השבוע:
- אימונים שהושלמו: ${completed.length}/${weekWorkouts.length}
- אימונים שדולגו: ${skipped.length}
- ק״מ מתוכנן: ${totalPlannedKm} ק״מ
- ק״מ בפועל: ${Math.round(totalActualKm * 10) / 10} ק״מ
- מאמץ ממוצע: ${avgEffort}/10

פירוט אימונים השבוע:
${workoutLines || 'אין נתונים'}

תוכנית שבוע הבא:
${nextWeekLines || 'אין תוכנית עדיין'}

${coachNotes ? `הערות המאמן: ${coachNotes}` : ''}`

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
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()
    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || '{}'
    return NextResponse.json({ summary: JSON.parse(text) })
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
