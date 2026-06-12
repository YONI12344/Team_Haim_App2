import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה העוזר של מאמן חיים. אתה מנתח נתוני ספורטאי ונותן למאמן סיכום קצר בעברית.

נתח את האימונים האחרונים וענה בעברית:
1. מה ראיתי - מה קרה באימונים האחרונים (היה קשה? קל? יותר מדי? פחות מדי?)
2. מצב הספורטאי עכשיו - הערכה כללית
3. מה אני מציע לשבועיים הקרובים - רק נקודות, לא תוכנית מלאה
4. שאלה למאמן - שאלה אחת אם משהו לא ברור

היה קצר - 4 נקודות בלבד. דבר ישירות למאמן חיים.
תמיד שמרני - עדיף פחות מדי מאשר פציעה.
סקלת מאמץ: ריצה קלה 4-5/10, פארטלק חלקים קשים מקסימום 6-7/10, גבעות קצרות 7/10, לעולם לא מעל 8/10 באימון.`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      athleteName,
      fitnessDescription,
      goalRace,
      goalRaceDate,
      lastWorkouts,
      lastWorkoutFeel,
      lastWorkoutComment,
    } = body

    const apiKey = process.env.GROQ_API_KEY || ''

    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    const userMessage = `ספורטאי: ${athleteName}
תיאור כושר: ${fitnessDescription}
מירוץ יעד: ${goalRace}
תאריך מירוץ: ${goalRaceDate}
אימונים אחרונים: ${JSON.stringify(lastWorkouts, null, 2)}
תחושה באימון האחרון (1-10): ${lastWorkoutFeel}
הערת הספורטאי: ${lastWorkoutComment}`

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
        temperature: 0.3,
        max_tokens: 1024,
      }),
    })

    const data = await response.json()

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || ''
    return NextResponse.json({ text })
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
