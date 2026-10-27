import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * Modal — focus trap, ESC za zatvaranje, vraćanje fokusa na trigger,
 * scroll lock i role="dialog"/aria-modal.
 */
const meta = {
  title: 'UI Kit/Modal',
  component: Modal,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
    size: { control: 'radio', options: ['sm', 'md', 'lg'] },
  },
  args: {
    open: true,
    onClose: fn(),
    title: 'Potvrda akcije',
    description: 'Ovo se ne može poništiti.',
    footer: (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost">Otkaži</Button>
        <Button variant="danger">Obriši</Button>
      </div>
    ),
    children: <p className="text-sm text-[var(--color-text-secondary)]">Sadržaj dijaloga — opis ili forma.</p>,
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Small: Story = {
  args: { size: 'sm', title: 'Mali dijalog', description: 'Potvrda jedne linije.' },
};

export const Large: Story = {
  args: { size: 'lg', title: 'Veliki dijalog', description: 'Forme i tabele sa više prostora.' },
};

/** Zatvoren modal — prazan stub (kontrola `open` u Controls panelu). */
export const Closed: Story = {
  args: { open: false },
};
