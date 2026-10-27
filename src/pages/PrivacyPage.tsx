import { LegalLayout, type LegalDoc } from '../components/legal/LegalLayout';

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

const SECTIONS: LegalDoc['sections'] = [
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
      'Saglasnost — newsletter. Newsletter mejlovi se trenutno ne šalju; saglasnost se može povući u svakom trenutku (odjava u profilu).',
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
      'Resend ili Brevo — slanje transakcionih mejlova (samo verifikacija adrese i reset lozinke).',
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
];

export const PRIVACY_DOC: LegalDoc = {
  eyebrow: 'Legal',
  title: 'Politika privatnosti',
  description:
    'Koje podatke NEXUS obrađuje, zašto, koliko ih čuva i kako ih preuzimate ili brišete — napisano onako kako sistem zaista radi.',
  version: 'Verzija 3.0 — Datum važenja: 20.10.2026.',
  icon: 'shield',
  sections: SECTIONS,
};

export default function PrivacyPage() {
  return (
    <LegalLayout
      doc={PRIVACY_DOC}
      footerNote="Konačan tekst proverava pravnik; podaci o rukovaocu se popunjavaju pre objavljivanja. Izvoz i brisanje podataka rade odmah iz Profil → Podešavanja."
    />
  );
}
