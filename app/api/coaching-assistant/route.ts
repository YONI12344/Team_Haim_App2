import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה מאמן ריצה מקצועי בכיר של קבוצת Team Haim.
תפקידך לנתח לעומק את נתוני הספורטאי ולכתוב דוח אימון מקיף ומקצועי בעברית.

פילוסופיית Team Haim:
- עקביות > עצימות
- 80% ריצות קלות, 20% עצימות
- שבוע ירידה כל 3-4 שבועות (הפחתת 20-30% נפח)
- לא שני ימים קשים ברצף
- ריצה ארוכה אחת בשבוע

החזר JSON תקין בלבד, ללא טקסט נוסף:
{
  "weekType": "down_week|build_week|normal_week|recovery_week",
  "weekTypeReason": "הסבר קצר 1-2 משפטים",
  "fitnessStatus": "תיאור מצב הכושר הנוכחי",
  "week1Analysis": "ניתוח מפורט של השבוע הראשון (הישן ביותר מבין 3 השבועות)",
  "week2Analysis": "ניתוח מפורט של השבוע השני",
  "week3Analysis": "ניתוח מפורט של השבוע השלישי (האחרון)",
  "struggles": "נקודות חולשה — מה קשה לספורטאי",
  "strengths": "נקודות חוזקה — מה הספורטאי עושה טוב",
  "loadAnalysis": "ניתוח עומס: מגמת העומס, האם יש עלייה/ירידה, ממוצעים",
  "goalProgressAnalysis": "ניתוח התקדמות לקראת המטרה/מירוץ",
  "keyObservations": ["תצפית 1", "תצפית 2", "תצפית 3"],
  "coachRecommendations": "המלצות ספציפיות למאמן לשבוע הקרוב",
  "riskFlags": ["דגל אדום 1 אם יש — רשימה ריקה אם אין"]
}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      athleteName,
      goalRace,
      goalRaceDate,
      weeksToRace,
      weeklyKmTarget,
      personalRecords = [],
      last3WeeksWorkouts = [],
      week1Summary,
      week2Summary,
      week3Summary,
    } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    const workoutLines = last3WeeksWorkouts
      .map((w: any) => {
        const st = w.status === 'completed' ? 'הושלם' : w.status === 'skipped' ? 'דולג' : 'מתוכנן'
        let line = `- ${w.date}: ${w.title} (${w.type}, ${st}`
        if (w.plannedKm) line += `, מתוכנן: ${w.plannedKm}ק"מ`
        if (w.actualKm) line += `, בפועל: ${w.actualKm}ק"מ`
        if (w.effort) line += `, מאמץ: ${w.effort}/10`
        if (w.athleteComment) line += `, הערה: "${w.athleteComment}"`
        if (w.wasSkipped) line += ` [דולג]`
        line += ')'
        return line
      })
      .join('\n')

    const formatSummary = (s: any, label: string) => {
      if (!s) return `${label}: אין נתונים`
      return `${label}: מתוכנן ${s.totalPlanned || 0}ק"מ, בפועל ${s.totalActual || 0}ק"מ, הושלמו ${s.completed || 0}/${(s.completed || 0) + (s.skipped || 0)} אימונים, ממוצע מאמץ ${s.avgEffort || 'לא ידוע'}`
    }

    const prLines = personalRecords.length > 0
      ? personalRecords.slice(0, 5).map((pr: any) => `- ${pr.distance}: ${pr.time}`).join('\n')
      : 'לא ידועים'

    const userMessage = `ספורטאי: ${athleteName}
מטרה: ${goalRace || 'לא הוגדרה'}
תאריך מירוץ: ${goalRaceDate || 'לא ידוע'}
שבועות למירוץ: ${weeksToRace ?? 'לא ידוע'}
יעד ק"מ שבועי: ${weeklyKmTarget || 'לא הוגדר'}

שיאים אישיים:
${prLines}

${formatSummary(week1Summary, 'שבוע 1 (3 שבועות אחורה)')}
${formatSummary(week2Summary, 'שבוע 2 (שבועיים אחורה)')}
${formatSummary(week3Summary, 'שבוע 3 (שבוע שעבר)')}

פירוט אימונים 21 הימים האחרונים (${last3WeeksWorkouts.length} אימונים):
${workoutLines || 'אין נתונים'}`

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
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()
    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || '{}'
    return NextResponse.json({ report: JSON.parse(text) })
  } catch (err) {
    console.error('Coaching assistant error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
