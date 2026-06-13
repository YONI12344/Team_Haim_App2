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
    const { userMessage } = body

    const apiKey = process.env.GROQ_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set' }, { status: 500 })
    }

    if (!userMessage) {
      return NextResponse.json({ error: 'Missing userMessage' }, { status: 400 })
    }

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
