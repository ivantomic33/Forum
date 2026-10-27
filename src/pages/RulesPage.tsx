import { LegalLayout, type LegalDoc } from '../components/legal/LegalLayout';

/**
 * U-13 — Pravila foruma koriste isti pravni okvir kao Uslovi i Privatnost:
 * sadržaj dokumenta + put nazad u zajednicu (umesto tri ista šablona).
 */
export const RULES_DOC: LegalDoc = {
  eyebrow: 'Zajednica',
  title: 'Pravila foruma',
  description:
    'Pravila postoje da forum ostane mesto za dobru diskusiju, a ne za flame warove. Kratka su, jasna i važe za sve.',
  version: 'Verzija 3.0 — na snazi od 20.10.2026.',
  icon: 'rules',
  sections: [
    {
      id: '1',
      title: 'Poštujte druge članove',
      bullets: [
        'Bez uvreda, pretnji i govora mržnje — bilo koje vrste.',
        'Bez uznemiravanja (harassment) i praćenja drugih korisnika.',
        'Bez objavljivanja ličnih podataka drugih osoba (doxxing).',
        'Različita mišljenja su dobrodošla — diskusija da, agresija ne.',
      ],
    },
    {
      id: '2',
      title: 'Bez spama i reklama',
      bullets: [
        'Bez ponavljanja istih poruka ili otvaranja duplih tema.',
        'Reklamiranje sopstvenih projekata/servisa samo u označenoj sekciji.',
        'Bez affiliate linkova i skrivenih reklama.',
        'Bez veštačkog skupljanja (farming) karme i XP-a glasanjem.',
      ],
    },
    {
      id: '3',
      title: 'Sadržaj pošten i legalan',
      bullets: [
        'Bez linkova na pirateriju, crackove i ilegalna preuzimanja.',
        'Bez NSFW sadržaja (slike, video, tekst).',
        'Citirajte izvore kada prenosite vesti iz drugih medija.',
        'Spojlere za velike igre označite pre nego što ih napišete.',
      ],
    },
    {
      id: '4',
      title: 'Moderacija',
      bullets: [
        'Moderatori mogu urediti ili ukloniti objave koje krše pravila.',
        'Uporne povrede pravila vode: upozorenje → privremena suspenzija → trajna suspenzija.',
        'Prigovor na moderaciju šaljite privatno adminima, ne javno u temama.',
      ],
      italic:
        'Ozbiljne povrede (doxxing, pretnje, ilegalni sadržaj) vode u trajnu suspenziju bez upozorenja.',
    },
  ],
};

export default function RulesPage() {
  return (
    <LegalLayout
      doc={RULES_DOC}
      footerNote="Kršenje pravila može rezultirati brisanjem objava, gubitkom karme ili suspenzijom naloga — zavisno od ozbiljnosti prekršaja."
    />
  );
}
