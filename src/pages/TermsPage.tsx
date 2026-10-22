import { Link } from 'react-router-dom';
import { FileText, Shield, Scale } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
  italic?: string;
}

/** F-28 — tekst lektorisan; č/ć/ž/š/đ ispravno (latinica). */
const SECTIONS: Section[] = [
  {
    id: '1',
    title: 'Uslovi korišćenja i odgovornost',
    body: [
      'Dobrodošli na NEXUS GG Community Portal. Korišćenjem portala prihvatate ove uslove korišćenja u celosti. Portal je namenjen gejming zajednici za objavljivanje vesti, vođenje forum diskusija i povezivanje igrača.',
      'Nalog je ličan i neprenosiv. Odgovorni ste za svu aktivnost pod vašim nalogom, uključujući bezbednost lozinke. Zabranjeno je deljenje naloga između više osoba.',
    ],
    bullets: [
      'Jedan nalog po osobi — višestruki nalozi se mogu suspendovati.',
      'Tačne informacije pri registraciji (validan email, ispravno korisničko ime).',
      'Privremene (disposable) email adrese nisu dozvoljene.',
      // F-21 — uzrast i evidencija saglasnosti (ZZPL: saglasnost od 15 godina).
      'Nalog mogu da otvore osobe sa najmanje 15 godina. Za mlađe korisnike potrebna je saglasnost roditelja ili staratelja — portal takve naloge ne otvara automatski.',
      'Pri registraciji se beleži verzija uslova, vreme i IP adresa prihvatanja — kao dokaz saglasnosti.',
    ],
  },
  {
    id: '2',
    title: 'Pravila zajednice',
    body: [
      'Cilj zajednice je pozitivna, inkluzivna atmosfera. Sledeća pravila važe za sve objave, teme, odgovore i komentare na portalu:',
    ],
    bullets: [
      'Zabranjen je govor mržnje, uvrede, diskriminacija i uznemiravanje drugih članova.',
      'Zabranjen je spam, reklama bez odobrenja i zloupotreba sistema glasanja.',
      'Zabranjeno je objavljivanje ilegalnog, nasilnog ili eksplicitnog sadržaja.',
      'Poštujte autorska prava — ne objavljujte sadržaj koji nije vaš bez dozvole.',
      'Moderatori i administracija imaju pravo da urede, uklone objave i suspenduju naloge koji krše pravila.',
    ],
  },
  {
    id: '3',
    title: 'Sadržaj i licenca',
    body: [
      'Zadržavate autorska prava na sadržaj koji objavljujete. Objavljivanjem na portalu dajete NEXUS-u neekskluzivnu, besplatnu licencu da vaš sadržaj prikazuje, distribuira i arhivira u okviru portala i njegovih zvaničnih kanala.',
      'Ne smete objavljivati sadržaj koji ne pripada vama bez odgovarajuće dozvole autora. Automatsko prikupljanje podataka (scraping) bez pisanog odobrenja je zabranjeno.',
    ],
  },
  {
    id: '4',
    title: 'Privatnost i zaštita podataka',
    body: [
      'Prikupljamo minimalno potrebne podatke: email adresu, korisničko ime i tehničke podatke potrebne za rad portala. Lozinke se čuvaju isključivo u heširanom obliku (bcrypt, cost 12) i nikada u čistom tekstu.',
      'Ne prodajemo i ne iznajmljujemo vaše lične podatke trećim stranama. Nalog i prateće podatke možete trajno obrisati iz podešavanja profila („Obriši nalog“), a kopiju podataka preuzeti preko „Preuzmi svoje podatke“. Detalji su u politici privatnosti.',
    ],
    bullets: [
      'Email se koristi za prijavu, obaveštenja i povratak lozinke.',
      'Sesijski token važi 12 sati, a uz „Zapamti me“ opciju do 7 dana; odjavom ili promenom lozinke sve sesije prestaju da važe.',
      'Podaci se ne dele sa oglašivačkim mrežama.',
    ],
  },
  {
    id: '5',
    title: 'Moderacija i primena',
    body: [
      'Administracija zadržava pravo da suspenduje ili trajno ukloni naloge koji krše ove uslove, uz ili bez prethodnog obaveštenja, zavisno od ozbiljnosti prekršaja. Odluke o moderaciji mogu se osporiti kontaktiranjem podrške.',
    ],
    italic:
      'Portal se pruža „kao jeste“. Ne garantujemo neprekidnost servisa, tačnost sadržaja koji objavljuju korisnici, ni pogodnost za određenu namenu.',
  },
  {
    id: '6',
    title: 'Izmene uslova',
    body: [
      'Uslovi korišćenja mogu se menjati. O značajnim izmenama obaveštavamo putem portala ili email-a. Nastavak korišćenja portala nakon objavljivanja izmena znači prihvatanje ažuriranih uslova.',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="section">
      <div className="container max-w-4xl">
        <div className="text-center mb-10">
          <div className="eyebrow mb-4">
            <Scale size={14} />
            Legal
          </div>
          <h1 className="page-title mb-3">Uslovi korišćenja</h1>
          <p className="text-white/60 text-sm">Verzija 3.0 — Datum važenja: 20.10.2026.</p>
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
              {section.body.map((p, i) => (
                <p key={i} className="text-white/55 text-sm leading-relaxed mb-2">{p}</p>
              ))}
              {section.bullets && (
                <ul className="space-y-1.5 pl-1">
                  {section.bullets.map((b, i) => (
                    <li key={i} className="text-white/55 text-sm leading-relaxed flex gap-2">
                      <span className="text-[var(--color-primary)] mt-0.5">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {section.italic ? (
                <p className="text-white/50 text-sm italic leading-relaxed border-l-2 border-[var(--color-primary)]/30 pl-4 mt-3">
                  {section.italic}
                </p>
              ) : null}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-center gap-6 mt-8 text-sm">
          <Link to="/privacy" className="text-[var(--color-primary-fg)] hover:text-[var(--color-primary-hover)] transition flex items-center gap-1.5">
            <Shield size={15} /> Politika privatnosti
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
