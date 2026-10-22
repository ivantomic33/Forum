/** F-20 — tipovi za Vite plugin sa sigurnosnim zaglavljima. */
export function securityHeaders(options?: { https?: boolean; dev?: boolean }): Record<string, string>;
export function securityHeadersPlugin(options?: { https?: boolean }): {
  name: string;
  configureServer(server: { middlewares: { use(fn: (req: unknown, res: any, next: () => void) => void): void } }): void;
  configurePreviewServer(server: { middlewares: { use(fn: (req: unknown, res: any, next: () => void) => void): void } }): void;
};
