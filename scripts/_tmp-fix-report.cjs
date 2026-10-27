// Popravka ReportButton.tsx: hardcoded srpski stringovi → i18n ključevi.
// Mojibake karakteri (nevalidni UTF-8 ostaci) sprečavaju edit alat, pa se
// transformacija radi liniju-po-liniju preko prefiksa.
const fs = require('fs');
const p = 'src/components/ReportButton.tsx';
let t = fs.readFileSync(p, 'utf8');
let lines = t.split('\n');
let changed = 0;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // 1) REASONS: label: '...' → labelKey: 'reports.reason…' (po vrednosti)
  if (/value:\s*'spam',\s*label:/.test(l)) { lines[i] = "  { value: 'spam', labelKey: 'reports.reasonSpam' },"; changed++; }
  else if (/value:\s*'harassment',\s*label:/.test(l)) { lines[i] = "  { value: 'harassment', labelKey: 'reports.reasonHarassment' },"; changed++; }
  else if (/value:\s*'off_topic',\s*label:/.test(l)) { lines[i] = "  { value: 'off_topic', labelKey: 'reports.reasonOffTopic' },"; changed++; }
  else if (/value:\s*'illegal',\s*label:/.test(l)) { lines[i] = "  { value: 'illegal', labelKey: 'reports.reasonIllegal' },"; changed++; }
  else if (/value:\s*'spoiler',\s*label:/.test(l)) { lines[i] = "  { value: 'spoiler', labelKey: 'reports.reasonSpoiler' },"; changed++; }
  else if (/value:\s*'other',\s*label:/.test(l)) { lines[i] = "  { value: 'other', labelKey: 'reports.reasonOther' },"; changed++; }
  // 2) handleSubmit — label/lookup
  else if (l.includes('REASONS.find((r) => r.value === reason)?.label ?? reason')) {
    lines[i] = "    const selected = t(REASONS.find((r) => r.value === reason)?.labelKey ?? 'reports.reasonOther');";
    changed++;
  }
  else if (l.includes('toast.error(') && l.includes('10 karaktera')) { lines[i] = "      toast.error(t('reports.minReason'));"; changed++; }
  else if (l.includes('toast.success(') && l.includes('Prijava je poslata')) { lines[i] = "      toast.success(t('reports.submitted'));"; changed++; }
  else if (l.includes('toast.error(err?.message') && l.includes('Prijava nije poslata')) { lines[i] = "      toast.error(err?.message || t('reports.failed'));"; changed++; }
  // 3) Modal metapodaci (title/description/dugmad/labeli/placeholder)
  else if (l.trim().startsWith('title="Prijavi sadr')) { lines[i] = "        title={t('reports.title')}"; changed++; }
  else if (l.trim().startsWith('description="Moderator')) { lines[i] = "        description={t('reports.subtitle')}"; changed++; }
  else if (l.trim() === 'Otka\u017ei' || l.includes('Otka') && l.trim().endsWith('i') && lines[i - 1]?.includes('variant="ghost"')) { lines[i] = "              {t('common.cancel')}"; changed++; }
  else if (l.includes('Po') && l.includes('alji prijavu')) { lines[i] = "              {t('reports.send')}"; changed++; }
  else if (l.trim() === '<span className="text-xs font-medium text-white/70">Razlog</span>') { lines[i] = "            <span className=\"text-xs font-medium text-white/70\">{t('reports.reason')}</span>"; changed++; }
  else if (l.includes('Dodatno obja') && l.includes('njenje')) { lines[i] = "            <span className=\"text-xs font-medium text-white/70\">{t('reports.note')}</span>"; changed++; }
  else if (l.includes('placeholder="Kratko opi')) { lines[i] = "              placeholder={t('reports.notePlaceholder')}"; changed++; }
  else if (l.includes('title="Prijavi sadr\u017eaj moderatorima"') || (l.includes('title="Prijavi sadr') && l.includes('moderatorima'))) { lines[i] = "        title={t('reports.tooltip')}"; changed++; }
}

// 4) {r.label} → {t(r.labelKey)}
t = lines.join('\n');
t = t.split('{r.label}').join('{t(r.labelKey)}');

fs.writeFileSync(p, t, 'utf8');
console.log('changed lines:', changed);
