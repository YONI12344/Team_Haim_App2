import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה עוזר מאמן ריצה מקצועי של קבוצת Team Haim.

פילוסופיית אימון Team Haim:
- עקביות > עצימות: עדיף 4 ריצות קלות מ-2 קשות
- 80% מהריצות בקצב קל (יכול לנהל שיחה)
- שבוע ירידה כל 3-4 שבועות: הפחת נפח 20-30%
- לא שני ימים קשים ברצף
- ריצה ארוכה אחת בשבוע, בסוף השבוע
- לפחות יום מנוחה מלא אחד בשבוע

תפקידך: לנתח את מצב הספורטאי ולהמליץ על אימונים לימים הפנויים בלבד.
המאמן הוא שמחליט ומשבץ את האימונים — אתה רק נותן המלצות.

החזר JSON תקין בלבד, ללא טקסט נוסף:
{
  "weekType": "רגיל",
  "weekTypeReason": "הסבר קצר",
  "totalSuggestedKm": 45,
  "analysis": "ניתוח קצר 2-3 משפטים של המצב הנוכחי",
  "suggestions": [
    {
      "date": "2025-06-15",
      "dayName": "ראשון",
      "suggestedType": "easy",
      "suggestedTitle": "ריצה קלה",
      "suggestedDistance": 8,
      "suggestedDuration": 50,
      "reason": "הסבר קצר"
    }
  ],
  "warnings": [],
  "coachTips": "טיפ כללי למאמן לשבוע הזה"
}

weekType חייב להיות אחד מ: "רגיל" | "ירידה" | "עצימות" | "טייפר"
suggestedType חייב להיות אחד מ: easy | long_run | tempo | intervals | recovery | rest`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      athleteName,
      last3WeeksWorkouts = [],
      next14Days = [],
      athleteWeeklyKmTarget,
      currentGoal,
      weeksToRace,
    } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    const completed = last3WeeksWorkouts.filter((w: any) => w.status === 'completed')
    const totalKm = completed.reduce(
      (s: number, w: any) => s + (w.actualDistance || w.distance || 0),
      0,
    )

    const workoutLines = last3WeeksWorkouts
      .map((w: any) => {
        const st =
          w.status === 'completed' ? 'הושלם' : w.status === 'skipped' ? 'דולג' : 'מתוכנן'
        return `- ${w.date}: ${w.title} (${st}${w.distance ? `, ${w.distance}ק"מ` : ''}${w.effort ? `, מאמץ ${w.effort}/10` : ''})`
      })
      .join('\n')

    const dayScheduleLines = next14Days
      .map((d: any) => {
        if (d.hasWorkout) {
          return `- ${d.date} (${d.dayName}): משובץ — ${d.existingWorkouts.map((w: any) => w.title).join(', ')}`
        }
        return `- ${d.date} (${d.dayName}): פנוי`
      })
      .join('\n')

    const unassignedCount = next14Days.filter((d: any) => !d.hasWorkout).length

    const userMessage = `ספורטאי: ${athleteName}
מטרה: ${currentGoal || 'לא הוגדרה'}
יעד ק"מ שבועי: ${athleteWeeklyKmTarget || 'לא הוגדר'}
שבועות למירוץ: ${weeksToRace ?? 'לא ידוע'}

3 שבועות אחרונים (${last3WeeksWorkouts.length} אימונים, ${totalKm.toFixed(1)} ק"מ הושלמו):
${workoutLines || 'אין נתונים'}

14 הימים הקרובים:
${dayScheduleLines}

המלץ רק על ${unassignedCount} הימים הפנויים. אל תמליץ על ימים שכבר משובצים.`

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()
    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || '{}'
    return NextResponse.json(JSON.parse(text))
  } catch (err) {
    console.error('Coaching assistant error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
