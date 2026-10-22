import { useEffect, useRef } from 'react';
import { Check, FileText, X } from 'lucide-react';

interface TermsModalProps {
  open: boolean;
  onAccept: () => void;
  onClose: () => void;
}

/**
 * Modal sa pravnim uslovima korišćenja NEXUS portala.
 * Checkbox na registracionoj formi može biti označen samo putem
 * dugmeta "Pročitao/la sam i slažem se" unutar ovog modala.
 */
export default function TermsModal({ open, onAccept, onClose }: TermsModalProps) {
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    acceptRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="terms-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      onClick={onClose}
    >
      <div className="terms-modal" onClick={(e) => e.stopPropagation()}>
        <header className="terms-modal-head">
          <div className="terms-modal-head-main">
            <span className="terms-modal-icon" aria-hidden="true">
              <FileText size={20} />
            </span>
            <div className="terms-modal-heading">
              <h2 id="terms-modal-title">Uslovi korišćenja i Pravila privatnosti</h2>
              <p className="terms-modal-subtitle">Verzija 2.1 · Datum važenja: 01.01.2026.</p>
            </div>
          </div>
          <button type="button" className="terms-modal-close" onClick={onClose} aria-label="Zatvori">
            <X size={16} />
          </button>
        </header>

        <div className="terms-modal-body">
          <section className="terms-section">
            <h3>1. Uslovi korišćenja i odgovornost</h3>
            <p>
              Dobrodošli na NEXUS GG Community Portal. Pristupom i registracijom prihvatate ove uslove i obavezujete se
              da ćete ih se pridržavati. Portal je namenjen igračkoj zajednici i sadržaj objavljujete na sopstvenu
              odgovornost.
            </p>
            <p className="terms-disclaimer">
              Portal se pruža „kao jest“ i „kako je dostupan“, bez ikakvih garancija, izričitih ili podrazumevanih.
              NEXUS GG ne garantuje neprekinut rad servisa niti tačnost sadržaja koji objavljuju korisnici.
            </p>
          </section>

          <section className="terms-section">
            <h3>2. Pravila zajednice</h3>
            <ul>
              <li>Poštujte druge igrače — zabranjeni su uvredljivi, mržnjonosni i diskriminirajući sadržaj i uznemiravanje.</li>
              <li>Zabranjen je spam, masovno oglašavanje i deljenje zlonamernih linkova ili fajlova.</li>
              <li>Ne objavljujte tuđi sadržaj bez dozvole autora niti sadržaj koji podstiče nasilje.</li>
              <li>Jedan nalog po osobi — deljenje, prodaja i pozajmljivanje naloga su zabranjeni.</li>
              <li>Administracija može ukloniti sadržaj i suspendovati naloge koji krše pravila, uz obrazloženje.</li>
            </ul>
          </section>

          <section className="terms-section">
            <h3>3. Sadržaj i licenca</h3>
            <p>
              Zadržavate autorska prava na svojim objavama. Objavljivanjem sadržaja dajete nam neekskluzivnu, prenosivu
              licencu da ga prikazujemo, arhiviramo i distribuiramo u okviru portala, isključivo u svrhu rada servisa.
            </p>
          </section>

          <section className="terms-section">
            <h3>4. Privatnost i podaci</h3>
            <p>
              Sakupljamo minimalno potrebne podatke (email adresa, korisničko ime, tehnički podaci o sesiji). Vaše
              podatke ne prodajemo trećim stranama. Možete zatražiti izvoz ili brisanje naloga u svakom trenutku.
            </p>
            <p className="terms-disclaimer">
              Iako primenjujemo standardne bezbednosne mere, nijedan sistem nije apsolutno imun na rizike; korišćenje
              portala je na sopstvenu odgovornost.
            </p>
          </section>

          <section className="terms-section">
            <h3>5. Izmene uslova i raskid</h3>
            <p>
              Zadržavamo pravo izmene ovih uslova. O značajnim izmenama obaveštavamo na portalu. Nastavak korišćenja
              nakon izmena znači prihvatanje novih uslova. Nalog možete zatvoriti u svakom trenutku.
            </p>
          </section>
        </div>

        <footer className="terms-modal-foot">
          <button type="button" className="terms-modal-secondary" onClick={onClose}>
            Zatvori
          </button>
          <button type="button" ref={acceptRef} className="terms-modal-primary" onClick={onAccept}>
            <Check size={15} />
            Pročitao/la sam i slažem se
          </button>
        </footer>
      </div>
    </div>
  );
}
