import { LegalLayout, type LegalDoc } from '../components/legal/LegalLayout';

/**
 * U-13 — Uslovi korišćenja koriste pravni okvir (`LegalLayout`): sadržaj
 * dokumenta sa leve strane, put nazad u NEXUS sa desne. Tekst je nepromenjen (F-28).
 */
const SECTIONS: LegalDoc['sections'] = [
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

export const TERMS_DOC: LegalDoc = {
  eyebrow: 'Legal',
  title: 'Uslovi korišćenja',
  description:
    'Pravila korišćenja portala, odgovornost naloga i sadržaja, moderacija i izmene uslova — na jednom mestu, uvek dostupno.',
  version: 'Verzija 3.0 — Datum važenja: 20.10.2026.',
  icon: 'scale',
  sections: SECTIONS,
};

export default function TermsPage() {
  return (
    <LegalLayout
      doc={TERMS_DOC}
      footerNote="Vidi i Politiku privatnosti i Pravila foruma — dokumenti su povezani i važe zajedno."
    />
  );
}
