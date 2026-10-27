import type { Preview } from "@storybook/react";
import "../src/index.css";

/**
 * NEXUS preview — Tailwind v4 globalni stilovi, fontovi i CSS varijable.
 *
 * Tema: aplikacija je dark-first (`data-theme` na <html>, postavlja
 * `initTheme()` iz `src/lib/theme.ts`). Toolbar toggle radi kroz
 * `data-theme` atribut, bez kopiranja logike.
 */

/** Veličine Inter/Inter Tight/JetBrains Mono fontova koje app uvozi. */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/inter-tight/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

const preview: Preview = {
  parameters: {
    controls: {
      disable: false,
    },
    backgrounds: {
      default: "obsidian",
      values: [
        { name: "obsidian", value: "#0b0a10" },
        { name: "white", value: "#ffffff" },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "Svetla/tamna tema portala (data-theme na <html>)",
      toolbar: {
        title: "Tema",
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark (default)" },
          { value: "light", title: "Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme ?? "dark";
      document.documentElement.setAttribute("data-theme", theme);
      return Story();
    },
  ],
};

export default preview;
