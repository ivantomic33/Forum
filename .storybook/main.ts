import type { StorybookConfig } from "@storybook/react-vite";

/**
 * NEXUS — Storybook (Vite-Builder, gleiches Ökosystem wie die App).
 * Die Stories decken das UI-Kit (`src/components/ui`) ab und ersetzen die
 * manuellen Design-Screenshots aus `scripts/design`.
 */
const config: StorybookConfig = {
  stories: ["../src/components/ui/**/*.stories.@(ts|tsx)", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
};

export default config;
