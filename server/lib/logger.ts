import pino from 'pino';

/**
 * LOGGER
 * ------
 * Jedan red po zahtevu, čitljiv u razvoju, strukturiran (JSON) u produkciji.
 *
 * Podrazumevano je LJUDSKI format u razvoju:
 *   12:03:44  GET     /api/articles  200  57ms
 * U `NODE_ENV=production` (ili `LOG_FORMAT=json` za Render/Railway/Datadog)
 * emituje se standardni JSON — ne izgubi se mašinska obrada kad zatreba.
 *
 * `pino-pretty` je opciona dev zavisnost: ako nije instalirana, koristi se
 * `JSON.parse` transport (`stdio`, tiny) da ne bi pao start servera.
 */

const isProd = process.env.NODE_ENV === 'production';
const wantsJson = process.env.LOG_FORMAT === 'json' || (isProd && process.env.LOG_FORMAT !== 'pretty');
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

const LEVEL_COLOR: Record<number, string> = {
  10: '\x1b[90m', // trace
  20: '\x1b[36m', // debug
  30: '\x1b[32m', // info
  40: '\x1b[33m', // warn
  50: '\x1b[31m', // error
};

const colorFor = (level: number, text: string) =>
  process.stdout.isTTY ? `${LEVEL_COLOR[level] ?? ''}${text}\x1b[0m` : text;

const METHOD_WIDTH = 7;

function formatHuman(obj: any): string {
  const time = new Date(obj.time ?? Date.now()).toLocaleTimeString('sr-RS', { hour12: false });
  const req = obj.req;
  const res = obj.res;

  if (req) {
    const status = res?.statusCode ?? 0;
    const statusColor = status >= 500 ? 31 : status >= 400 ? 33 : 32;
    const statusText = process.stdout.isTTY ? `\x1b[${statusColor}m${String(status).padEnd(3)}\x1b[0m` : String(status).padEnd(3);
    // pino-http upisuje trajanje kao `responseTime` (ili `elapsedTime` u novijim verzijama)
    const rawMs = obj.responseTime ?? obj.elapsedTime;
    const ms = typeof rawMs === 'number' ? `${Math.round(rawMs)}ms` : '';
    return `${colorFor(30, `[${time}]`)}  ${String(req.method ?? '').padEnd(METHOD_WIDTH)} ${req.url ?? ''}  ${statusText} ${ms}`;
  }

  // Poruke aplikacije (start, seed, greške)
  const msg = obj.msg ?? (obj.error ?? '');
  // Kontekst (userId, type, err…) se ranije gubio u ljudskom formatu — bez njega
  // je `notification_create_failed` bio samo reč bez razloga. Ključna polja
  // (`error`, `type`, `code`, `count`, `status`) idu uz poruku, `err` kao razlog.
  const detailKeys = ['error', 'detail', 'code', 'type', 'status', 'count', 'userId', 'threadId', 'step'];
  const details = detailKeys
    .filter((key) => obj[key] !== undefined && obj[key] !== null)
    .map((key) => `${key}=${typeof obj[key] === 'object' ? JSON.stringify(obj[key]) : obj[key]}`)
    .join(' ');
  const err = obj.err;
  const errText =
    err && typeof err === 'object'
      ? ` | err=${err.message ?? err.type ?? JSON.stringify(err)}${err.code ? ` (${err.code})` : ''}`
      : '';
  const prefix = obj.level >= 40 ? colorFor(obj.level, '!') : ' ';
  return `${prefix} ${colorFor(30, `[${time}]`)}  ${msg}${details ? ` ${details}` : ''}${errText}`;
}

/**
 * Stream koji pretvara pino JSON liniju u ljudski čitljiv red.
 * Radi bez dodatnih zavisnosti i bez child procesa.
 */
function humanStream() {
  let buffer = '';
  return {
    write(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          process.stdout.write(formatHuman(JSON.parse(line)) + '\n');
        } catch {
          process.stdout.write(line + '\n');
        }
      }
    },
  } as any;
}

export const logger = pino(
  { level, base: undefined, timestamp: pino.stdTimeFunctions.epochTime },
  wantsJson ? pino.destination({ dest: 1, sync: true }) : humanStream(),
);

/**
 * Serijalizeri za pino-http — sprečavaju da ceo Express `req`/`res` objekat
 * (socket, stream, headers...) završi u logu.
 */
export const httpSerializers = {
  req: (req: any) => ({
    method: req.method,
    url: req.url,
    remoteAddress: req.remoteAddress,
  }),
  res: (res: any) => ({ statusCode: res.statusCode }),
  err: (err: any) => ({ type: err.type, message: err.message }),
};

/** Zajednička pino-http konfiguracija. */
export const httpLoggerOptions = {
  logger,
  serializers: httpSerializers,
  // Vreme odgovora je potrebno za "57ms" u redu
  customProps: () => ({}),
  customSuccessMessage: (req: any, res: any) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req: any, res: any) => `${req.method} ${req.url} ${res.statusCode}`,
  customAttributeKeys: { responseTime: 'responseTime' },
  quietReqLogger: true,
};
