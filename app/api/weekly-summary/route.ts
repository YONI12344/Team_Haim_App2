import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה AI של מאמן חיים. אתה מייצר סיכום שבועי קצר ומעשי בעברית לספורטאי.

בסס את הסיכום על האימונים שהושלמו בפועל, לא על מה שתוכנן.
היה חם ומעודד, אבל ישיר ומקצועי.
דבר ישירות לספורטאי בגוף שני.

החזר JSON תקין בלבד, ללא טקסט אחר:
{
  "weekSummary": "סיכום קצר של מה שקרה השבוע - 2-3 משפטים",
  "achievements": "הישגים והדגשים חיוביים מהשבוע",
  "improvements": "נקודה אחת או שתיים לשיפור, בצורה בונה",
  "nextWeekFocus": "פוקוס ומטרה לשבוע הבא - משפט אחד ברור",
  "coachNote": "הערה אישית של המאמן - אם סופקה השתמש בה, אחרת צור הצעה חמה"
}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { athleteName, weekWorkouts, weekStartDate, weekEndDate, coachNotes } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    const workoutLines = (weekWorkouts || []).map((w: any) =>
      `- ${w.scheduledDate}: ${w.workout?.title || 'אימון'} (${w.status === 'completed' ? 'הושלם' : w.status === 'skipped' ? 'דולג' : 'מתוכנן'}${w.workout?.distance ? `, ${w.workout.distance} ק"מ` : ''})`
    ).join('\n')

    const userMessage = `ספורטאי: ${athleteName}
שבוע: ${weekStartDate} עד ${weekEndDate}
אימונים השבוע:
${workoutLines || 'אין אימונים רשומים'}
${coachNotes ? `\nהערות המאמן: ${coachNotes}` : ''}`

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
        max_tokens: 1024,
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
