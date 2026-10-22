import { Link } from 'react-router-dom';
import { Shield, FileText, Scale } from 'lucide-react';

/**
 * F-09 — politika privatnosti opisuje STVARNE tokove podataka:
 * bcrypt cost 12, pravi double opt-in, TTL tokena, obrađivače i prava koja su
 * zaista implementirana (izvoz: GET /api/users/me/export, brisanje: DELETE /api/users/me).
 *
 * NAPOMENA: konačan tekst mora da proveri pravnik, a rukovalac (naziv firme,
 * adresa, matični broj) mora da se upiše pre objavljivanja.
 */

const RUKOVALAC = {
  naziv: 'NEXUS Gaming (popuniti pravno lice)',
  adresa: 'popuniti adresu sedišta',
  email: 'privacy@nexusgaming.com',
};

const SECTIONS = [
  {
    id: '1',
    title: 'Rukovalac podacima',
    bullets: [
      `Rukovalac: ${RUKOVALAC.naziv}, ${RUKOVALAC.adresa}.`,
      `Kontakt za zaštitu podataka: ${RUKOVALAC.email}.`,
      'Ako imate manje od 16 godina, nalog možete koristiti samo uz saglasnost roditelja ili staratelja.',
    ],
  },
  {
    id: '2',
    title: 'Koje podatke obrađujemo',
    bullets: [
      'Podaci naloga: korisničko ime, email adresa, hash lozinke, bio, avatar, podešavanja.',
      'Sadržaj: teme, odgovori, komentari, ankete, glasovi, reakcije, prijave, sačuvani sadržaj.',
      'Podaci o aktivnosti: nivo, XP, karma, bedževi, povezani gaming nalozi (Steam, Discord, Twitch, Epic, Riot, YouTube).',
      'Bezbednosni podaci: IP adresa i user-agent pri prijavi, potvrdi newsletter-a i resetu lozinke (radi zaštite od zloupotrebe).',
      'Podaci o pretplati na newsletter: email, vreme prijave, vreme i IP adresa potvrde (double opt-in).',
    ],
  },
  {
    id: '3',
    title: 'Pravni osnovi obrade',
    bullets: [
      'Izvršenje ugovora (čl. 12 Zakona o zaštiti podataka o ličnosti, ZZPL) — nalog, objavljivanje sadržaja, povezani nalozi.',
      'Saglasnost — newsletter. Saglasnost se daje potvrdom linka iz mejla i može se povući u svakom trenutku (link za odjavu u svakom mejlu).',
      'Legitimni interes — bezbednost servisa, sprečavanje spama i prevara, tehnički logovi.',
      'Pravna obaveza — čuvanje podataka o prijavama i moderaciji kada to zakon zahteva.',
    ],
  },
  {
    id: '4',
    title: 'Kako čuvamo lozinke',
    body:
      'Lozinke se nikada ne čuvaju u čitljivom obliku. Hashiraju se bcrypt algoritmom sa cost faktorom 12 (legacy naloci sa nižim faktorom se automatski rehash-uju pri sledećoj prijavi). Ni administratori nemaju pristup lozinci.',
  },
  {
    id: '5',
    title: 'Sesije i kolacici',
    body:
      'Prijava koristi JWT tokene koji se čuvaju isključivo u HttpOnly kolacicima („nx_at“ za pristup, „nx_rt“ za obnovu sesije) i nisu dostupni JavaScript kodu stranice. Pristupni token traje 15 minuta i tiho se obnavlja; sesija („Zapamti me“) traje do 7 dana, inače do 12 sati. Obnova sesije koristi rotaciju refresh tokena uz CSRF zaštitu, a ponovna upotreba već iskorišćenog tokena poništava celu sesiju. Odjavom, promenom ili resetom lozinke sve ranije sesije prestaju da važe. Koriste se isključivo neophodni kolacici; nema reklamnih niti tracking kolacica trećih strana.',
  },
  {
    id: '5a',
    title: 'Prijava preko trećih strana (OAuth)',
    body:
      'Pored email-a i lozinke, možete se prijaviti preko Discord-a, Google-a ili Steam-a. U tom slučaju od provajdera dobijamo samo identifikator naloga, email (ako ga deli) i javno ime/avatar — nikada lozinku. Povezivanje više provajdera sa istim NEXUS nalogom je opciono i možete ga otkačiti u podešavanjima profila.',
  },
  {
    id: '5b',
    title: 'Dvofaktorska autentifikacija (2FA)',
    body:
      'Možete uključiti 2FA zasnovanu na TOTP standardu (Aplikacije poput Google Authenticator, Authy ili Aegis). Tajni ključ se prikazuje kao QR kod i čuva se šifrovan; generišemo i jednokratne rezervne kodove, takođe u obliku heša. 2FA je trenutno opciona i toplo je preporučujemo svim korisnicima.',
  },
  {
    id: '6',
    title: 'Rokovi čuvanja',
    bullets: [
      'Nalog i sadržaj — dok je nalog aktivan; brisanjem naloga lični podaci se uklanjaju ili anonimizuju (javni sadržaj ostaje bez autora).',
      'Tokeni za verifikaciju email-a — do 24 sata; tokeni za reset lozinke — do 30 minuta; potvrda newsletter-a — do 48 sati.',
      'Bezbednosni logovi — najviše 90 dana.',
      'Dokaz saglasnosti za newsletter — dok god je pretplata aktivna i 2 godine nakon odjave (dokaz opt-in-a).',
    ],
  },
  {
    id: '7',
    title: 'Primaoci i obrađivači',
    bullets: [
      'Supabase (PostgreSQL baza) — hosting baze podataka.',
      'Resend ili Brevo — slanje transakcionih mejlova (verifikacija, reset, newsletter).',
      'DiceBear (api.dicebear.com) — generisanje avatara po korisničkom imenu. Javno korisničko ime i IP adresa pregledača odlaze tom servisu; alternativa je unos sopstvenog URL-a avatara ili slike iz lokalnog izbora (lokalno generisanje avatara je planirano).',
      'Unsplash — učitavanje ilustracija pozadine na auth ekranu (IP adresa se otkriva servisu).',
      'Sentry — opciono, prijava grešaka bez lozinki i tokena.',
      'Hosting provajder aplikacije i CDN.',
    ],
    body2:
      'Fontovi (Inter, Inter Tight, JetBrains Mono) se serviraju sa našeg domena preko @fontsource paketa — nema zahteva ka Google Fonts. Neki od navedenih obrađivača (npr. Resend, DiceBear, Sentry) mogu obrađivati podatke izvan Srbije; prenos se vrši na osnovu standardnih ugovornih klauzula. Ne prodajemo podatke i ne koristimo ih za oglašavanje.',
  },
  {
    id: '8',
    title: 'Vaša prava',
    bullets: [
      'Pristup i prenosivost — izvoz svih svojih podataka preko Profil → Podešavanja → „Preuzmi svoje podatke“ (JSON).',
      'Ispravka — izmena profila u profilu ili putem kontakta.',
      'Brisanje — Profil → Podešavanja → „Obriši nalog“. Lični podaci se brišu, sesije i newsletter se odjavljuju, a javni sadržaj se anonimizuje.',
      'Ograničenje i prigovor — putem email adrese za zaštitu podataka.',
      'Pritužba — Povereniku za informacije od javnog značaja i zaštitu podataka o ličnosti Republike Srbije.',
    ],
  },
  {
    id: '9',
    title: 'Kontakt',
    body: `Za sva pitanja o obradi podataka: ${RUKOVALAC.email}. Odgovaramo u roku od 30 dana od prijema zahteva.`,
  },
] as const;

export default function PrivacyPage() {
  return (
    <div className="section">
      <div className="container max-w-4xl">
        <div className="text-center mb-10">
          <div className="eyebrow mb-4">
            <Shield size={14} />
            Legal
          </div>
          <h1 className="page-title mb-3">Politika privatnosti</h1>
          <p className="text-white/60 text-sm">Verzija 3.0 — Datum važenja: 20.10.2026.</p>
          <p className="text-white/50 text-xs mt-2">
            Konačan tekst mora da proveri pravnik; podaci o rukovaocu se popunjavaju pre objavljivanja.
          </p>
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-surface-1 p-6 md:p-8 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.id} className="terms-section">
              <h3 className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-md bg-[var(--color-primary-subtle)] border border-[var(--color-primary)]/30 grid place-items-center text-xs font-bold text-[var(--color-primary-fg)] flex-shrink-0">
                  {section.id}
                </span>
                <span className="text-[var(--color-primary-fg)] font-bold">{section.title}</span>
              </h3>
              {'body' in section && section.body && (
                <p className="text-white/55 text-sm leading-relaxed mb-2">{section.body}</p>
              )}
              {'body2' in section && section.body2 && (
                <p className="text-white/55 text-sm leading-relaxed mb-2">{section.body2}</p>
              )}
              {'bullets' in section && section.bullets && (
                <ul className="space-y-1.5 pl-1">
                  {section.bullets.map((b, i) => (
                    <li key={i} className="text-white/55 text-sm leading-relaxed flex gap-2">
                      <span className="text-[var(--color-primary)] mt-0.5">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-center gap-6 mt-8 text-sm">
          <Link to="/terms" className="text-[var(--color-primary-fg)] hover:text-[var(--color-primary-hover)] transition flex items-center gap-1.5">
            <Scale size={15} /> Uslovi korišćenja
          </Link>
          <span className="text-white/20">|</span>
          <Link to="/rules" className="text-[var(--color-primary-fg)] hover:text-[var(--color-primary-hover)] transition flex items-center gap-1.5">
            <FileText size={15} /> Pravila foruma
          </Link>
        </div>
      </div>
    </div>
  );
}