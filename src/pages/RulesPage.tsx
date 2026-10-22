import { Link } from 'react-router-dom';
import { FileText, Shield, Scale } from 'lucide-react';

/** F-28 — tekst lektorisan; č/ć/ž/š/đ ispravno (latinica). */
const RULES = [
  {
    title: 'Poštujte druge članove',
    items: [
      'Bez uvreda, pretnji i govora mržnje — bilo koje vrste.',
      'Bez uznemiravanja (harassment) i praćenja drugih korisnika.',
      'Bez objavljivanja ličnih podataka drugih osoba (doxxing).',
      'Različita mišljenja su dobrodošla — diskusija da, agresija ne.',
    ],
  },
  {
    title: 'Bez spama i reklama',
    items: [
      'Bez ponavljanja istih poruka ili otvaranja duplih tema.',
      'Reklamiranje sopstvenih projekata/servisa samo u označenoj sekciji.',
      'Bez affiliate linkova i skrivenih reklama.',
      'Bez veštačkog skupljanja (farming) karme/XP-a glasanjem.',
    ],
  },
  {
    title: 'Sadržaj pošten i legalan',
    items: [
      'Bez linkova na pirateriju, crackove i ilegalne preuzimanja.',
      'Bez NSFW sadržaja (slike, video, tekst).',
      'Citirajte izvore kada prenosite vesti iz drugih medija.',
      'Spojlere za velike igre označite pre nego što ih napišete.',
    ],
  },
  {
    title: 'Moderacija',
    items: [
      'Moderatori mogu urediti ili ukloniti objave koje krše pravila.',
      'Uporne povrede pravila vode: upozorenje → privremena suspenzija → trajna suspenzija.',
      'Prigovor na moderaciju šaljite privatno adminima, ne javno u temama.',
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="section">
      <div className="container max-w-4xl">
        <div className="text-center mb-10">
          <div className="eyebrow mb-4">
            <FileText size={14} />
            Zajednica
          </div>
          <h1 className="page-title mb-3">Pravila foruma</h1>
          <p className="text-white/60 text-sm max-w-2xl mx-auto">
            Pravila postoje da forum ostane mesto za dobru diskusiju, a ne za flame warove. Kratka, jasna, važe za sve.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {RULES.map((group) => (
            <div key={group.title} className="rounded-lg border border-white/[0.09] bg-surface-1 p-6">
              <h3 className="text-[var(--color-primary-fg)] font-bold mb-3">{group.title}</h3>
              <ul className="space-y-2">
                {group.items.map((item, i) => (
                  <li key={i} className="text-white/55 text-sm leading-relaxed flex gap-2">
                    <span className="text-[var(--color-primary)] mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/[0.09] bg-surface-1 p-6 text-center">
          <p className="text-white/60 text-sm leading-relaxed mb-4">
            Kršenje pravila može rezultirati brisanjem objava, gubitkom karma poena ili suspenzijom naloga — zavisno od
            ozbiljnosti prekršaja. Ozbiljne povrede (doxxing, pretnje, ilegalni sadržaj) vode u trajnu suspenziju bez
            upozorenja.
          </p>
          <div className="flex items-center justify-center gap-6 text-sm">
            <Link to="/terms" className="text-[var(--color-primary-fg)] hover:text-[var(--color-primary-hover)] transition flex items-center gap-1.5">
              <Scale size={15} /> Uslovi korišćenja
            </Link>
            <span className="text-white/20">|</span>
            <Link to="/privacy" className="text-[var(--color-primary-fg)] hover:text-[var(--color-primary-hover)] transition flex items-center gap-1.5">
              <Shield size={15} /> Politika privatnosti
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
