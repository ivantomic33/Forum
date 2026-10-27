import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader } from './Card';
import { Badge } from './Badge';
import { Button } from './Button';

/**
 * Card — vizuelni kontejner sa tri nivoa elevacije.
 * `interactive` dodaje hover glow/translate (samo klikabilne kartice),
 * `flush` uklanja default padding, `compact` za stat pločice.
 */
const meta = {
  title: 'UI Kit/Card',
  component: Card,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'radio', options: ['default', 'static', 'elevated'] },
    interactive: { control: 'boolean' },
    flush: { control: 'boolean' },
    compact: { control: 'boolean' },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    className: 'p-5',
    children: (
      <>
        <CardHeader title="Kartica igre" subtitle="Recenzija · 12. okt 2026" />
        <p className="text-sm text-[var(--color-text-secondary)]">
          Sadržaj kartice — naslov, meta podaci i telo. Koristi se za članke, teme i deal-ove.
        </p>
      </>
    ),
  },
};

export const Interactive: Story = {
  args: {
    interactive: true,
    className: 'p-5',
    children: (
      <>
        <CardHeader
          title="Kartica deal-a"
          icon={<Badge tone="success">−57%</Badge>}
          subtitle="Steam · 1.199 RSD"
        />
        <p className="text-sm text-[var(--color-text-secondary)]">
          Hover glow — klikabilna kartica (link na deal ili temu).
        </p>
      </>
    ),
  },
};

export const WithAction: Story = {
  args: {
    className: 'p-5',
    children: (
      <>
        <CardHeader title="Kartica teme" subtitle="8 odgovora" action={<Button size="sm">Otvori</Button>} />
        <p className="text-sm text-[var(--color-text-secondary)]">Header sa akcijom desno (action slot).</p>
      </>
    ),
  },
};

export const CompactTile: Story = {
  args: {
    compact: true,
    className: 'p-4',
    children: <div className="font-mono text-2xl tabular-nums">12.400</div>,
  },
  parameters: { docs: { description: { story: 'Stat pločica — compact varijanta za mreže.' } } },
};
