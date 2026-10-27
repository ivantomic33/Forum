import type { Meta, StoryObj } from '@storybook/react';

/**
 * Field — `.ui-field` je jedini stil za input/select/textarea u aplikaciji
 * (nema zasebne Input komponente; forme koriste ovu klasu direktno).
 * Prikaz obuhvata default, focus i error stanje sa helper tekstom.
 */
const meta = {
  title: 'UI Kit/Fields',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;

export const Input: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, width: 320 }}>
      <label>
        <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">Email</span>
        <input className="ui-field" placeholder="uneti email…" />
      </label>
      <label>
        <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">Pretraga</span>
        <input className="ui-field" type="search" placeholder="Igra, tema…" />
      </label>
    </div>
  ),
};

export const Select: StoryObj = {
  render: () => (
    <div style={{ width: 320 }}>
      <label>
        <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">Kategorija</span>
        <select className="ui-field" defaultValue="">
          <option value="">— izaberi —</option>
          <option>Vesti</option>
          <option>Hardware</option>
          <option>Recenzija</option>
        </select>
      </label>
    </div>
  ),
};

export const Textarea: StoryObj = {
  render: () => (
    <div style={{ width: 320 }}>
      <label>
        <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">Sadržaj teme</span>
        <textarea className="ui-field" rows={4} placeholder="Opišite problem…" />
      </label>
    </div>
  ),
};

export const ErrorState: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 4, width: 320 }}>
      <label>
        <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">Naslov liste</span>
        <input className="ui-field" aria-invalid="true" defaultValue="ab" />
        <span className="text-xs text-[var(--color-error)]">Naslov liste je prekratak (min. 3 znaka).</span>
      </label>
    </div>
  ),
};
