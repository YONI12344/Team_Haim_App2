export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-2xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold mb-2">Team Haim</p>
          <h1 className="text-3xl font-serif font-bold text-navy mb-2">מדיניות פרטיות</h1>
          <p className="text-lg text-navy font-semibold">Privacy Policy</p>
          <p className="text-sm text-muted-foreground mt-2">עדכון אחרון / Last updated: June 2025</p>
        </div>

        {/* Hebrew section */}
        <section className="mb-10 space-y-5">
          <h2 className="text-lg font-bold text-navy border-b border-border pb-2">עברית</h2>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">מה אנחנו אוספים</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Team Haim משתמשת בנתוני Strava — כגון פעילויות ריצה, מרחק, טמפו ודופק — אך ורק כדי להציג למאמנים את אימוני הספורטאים שלהם. הנתונים מוצגים בתוך האפליקציה ואינם משמשים לכל מטרה אחרת.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">שיתוף נתונים</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              אנחנו לא מוכרים, משכירים או מעבירים נתונים אישיים לצד שלישי כלשהו.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">ניתוק Strava</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ספורטאים יכולים לנתק את חשבון ה-Strava שלהם בכל עת דרך עמוד הפרופיל באפליקציה. בעת הניתוק, הנתונים שסונכרנו מ-Strava מוסרים מחשבונם.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">אבטחה</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              הנתונים מאוחסנים באופן מאובטח באמצעות Firebase של Google ומוגנים בהרשאות גישה מבוססות תפקיד.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">צור קשר</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              לשאלות בנושא פרטיות:{' '}
              <a href="mailto:info.teamhaim@gmail.com" className="text-navy underline underline-offset-2">
                info.teamhaim@gmail.com
              </a>
            </p>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-border my-10" />

        {/* English section */}
        <section className="space-y-5" dir="ltr">
          <h2 className="text-lg font-bold text-navy border-b border-border pb-2">English</h2>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">What We Collect</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Team Haim uses Strava data — such as running activities, distance, pace, and heart rate — solely to show coaches their athletes' completed runs. Data is displayed within the app and is not used for any other purpose.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">Data Sharing</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We do not sell, rent, or transfer personal data to any third party.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">Disconnecting Strava</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Athletes can disconnect their Strava account at any time from the Profile page inside the app. Upon disconnection, any data synced from Strava is removed from their account.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">Security</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Data is stored securely using Google Firebase and protected by role-based access controls.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-navy">Contact</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              For privacy questions:{' '}
              <a href="mailto:info.teamhaim@gmail.com" className="text-navy underline underline-offset-2">
                info.teamhaim@gmail.com
              </a>
            </p>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-16 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">© 2025 Team Haim · All rights reserved</p>
        </div>

      </div>
    </div>
  )
}
