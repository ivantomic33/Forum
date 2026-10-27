import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Button } from './Button';

/**
 * Button — einzige Komponente für Buttons in der App.
 * Varianten: primary (violet), secondary (glass), ghost, danger.
 * Größen: sm, md, lg. `block` für volle Breite, `loading`/`disabled` Zustände.
 */
const meta = {
  title: 'UI Kit/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'radio', options: ['sm', 'md', 'lg'] },
    block: { control: 'boolean' },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: { onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary', children: 'Primär' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Sekundär' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Ghost' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Löschen' },
};

export const Small: Story = {
  args: { size: 'sm', children: 'Klein' },
};

export const Large: Story = {
  args: { size: 'lg', children: 'Groß' },
};

export const Loading: Story = {
  args: { children: 'Speichern…', loading: true },
};

export const Disabled: Story = {
  args: { children: 'Deaktiviert', disabled: true },
};

/** Alle Varianten und Größen — Design-Review-Matrix. */
export const AllVariants: Story = {
  args: { children: 'Button' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 16 }}>
      {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 80, fontFamily: 'monospace', fontSize: 12 }}>{variant}</span>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              {size}
            </Button>
          ))}
          <Button {...args} variant={variant} loading>
            loading
          </Button>
          <Button {...args} variant={variant} disabled>
            disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};
