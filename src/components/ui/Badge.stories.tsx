import type { Meta, StoryObj } from '@storybook/react';
import { Badge, categoryTone } from './Badge';

/**
 * Badge — statusi, cene, kategorije. Toned: primary, secondary, success,
 * warning, error, neutral, featured. `dot` dodaje tačkicu u boji tona.
 */
const meta = {
  title: 'UI Kit/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'radio',
      options: ['primary', 'secondary', 'success', 'warning', 'error', 'neutral', 'featured'],
    },
    dot: { control: 'boolean' },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { tone: 'primary', children: 'Vesti' },
};

export const WithDot: Story = {
  args: { tone: 'success', dot: true, children: 'Online' },
};

/** Svih 7 tonova u jednom redu — palete u design review-u. */
export const AllTones: Story = {
  args: { children: 'Badge' },
  render: (args) => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {(
        ['primary', 'secondary', 'success', 'warning', 'error', 'neutral', 'featured'] as const
      ).map((tone) => (
        <Badge key={tone} {...args} tone={tone} dot>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};

/** `categoryTone()` — mapiranje kategorija članaka na ton badge-a. */
export const CategoryMapping: Story = {
  args: { children: 'Vesti' },
  render: () => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {['Vesti', 'Hardware', 'Recenzija', 'Lista', 'Esports', 'PlayStation'].map((cat) => (
        <Badge key={cat} tone={categoryTone(cat)}>
          {cat}
        </Badge>
      ))}
    </div>
  ),
};
