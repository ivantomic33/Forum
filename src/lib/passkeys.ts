/**
 * 5.2 — PASSKEY (WebAuthn) NA KLIJENTU
 * -------------------------------------
 * Passkey zamenjuje lozinku javnim ključem: privatni deo nikad ne napušta
 * autentifikator (Touch ID / Windows Hello / telefon), pa nema šta da se
 * ukrade phishingom niti da procuri iz baze.
 *
 * Ovde je samo tanki sloj preko `navigator.credentials` — sva verifikacija je
 * na serveru (`server/lib/passkeys.ts`). Base64url helperi postoje jer
 * WebAuthn vraća `ArrayBuffer`, a JSON preko mreže nosi stringove.
 */
import { authRequest } from './api';

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  transports: string[];
}

const b64urlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const bytesToB64url = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** WebAuthn je dostupan samo u secure kontekstu (`https` ili `localhost`). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials);
}

/** Da li platforma ima ugrađen autentifikator (Touch ID / Windows Hello). */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Poruke za `NotAllowedError` i slično — bez tehničkog žargona. */
export function describePasskeyError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
      return 'Prijava je otkazana ili je isteklo vreme. Pokušajte ponovo.';
    case 'InvalidStateError':
      return 'Ovaj uređaj već ima passkey za NEXUS nalog.';
    case 'SecurityError':
      return 'Passkey zahteva HTTPS (ili localhost).';
    case 'NotSupportedError':
      return 'Ovaj uređaj ili browser ne podržava passkey.';
    default:
      return (error as { message?: string })?.message || 'Passkey radnja nije uspela.';
  }
}

/** Pretvara opcije sa servera (base64url) u `PublicKeyCredentialCreationOptions`. */
function toCreationOptions(options: Record<string, any>, username: string): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    user: {
      ...options.user,
      id: b64urlToBytes(options.user.id),
      displayName: options.user.displayName || username,
    },
    excludeCredentials: (options.excludeCredentials ?? []).map((credential: any) => ({
      ...credential,
      id: b64urlToBytes(credential.id),
    })),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function toRequestOptions(options: Record<string, any>): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((credential: any) => ({
      ...credential,
      id: b64urlToBytes(credential.id),
    })),
  } as PublicKeyCredentialRequestOptions;
}

/** Serializuje `PublicKeyCredential` u JSON koji server može da verifikuje. */
function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const json: Record<string, unknown> = {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
    },
  };
  const responseJson = json.response as Record<string, unknown>;

  if ('attestationObject' in response) {
    responseJson.attestationObject = bytesToB64url(response.attestationObject);
    responseJson.transports = typeof response.getTransports === 'function' ? response.getTransports() : [];
  }
  if ('authenticatorData' in response) {
    responseJson.authenticatorData = bytesToB64url(response.authenticatorData);
    responseJson.signature = bytesToB64url(response.signature);
    responseJson.userHandle = response.userHandle ? bytesToB64url(response.userHandle) : null;
  }
  return json;
}

/** 1. Registracija passkey-a za prijavljenog korisnika. */
export async function registerPasskey(name: string): Promise<PasskeySummary> {
  const begin = await authRequest<Record<string, any>>('/auth/passkeys/register/begin', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!begin.ok) throw Object.assign(new Error((begin.data as any)?.error ?? 'Passkey registrovanje nije dostupno.'), begin.data);

  const credential = (await navigator.credentials.create({
    publicKey: toCreationOptions(begin.data.options, begin.data.username ?? ''),
  })) as PublicKeyCredential | null;
  if (!credential) throw Object.assign(new Error('Registracija je otkazana.'), { name: 'NotAllowedError' });

  const finish = await authRequest<{ passkey: PasskeySummary }>('/auth/passkeys/register/finish', {
    method: 'POST',
    body: JSON.stringify({ challengeId: begin.data.challengeId, name, credential: serializeCredential(credential) }),
  });
  if (!finish.ok) throw Object.assign(new Error((finish.data as any)?.error ?? 'Passkey nije sačuvan.'), finish.data);
  return finish.data.passkey;
}

/**
 * 2. Prijava passkey-om (bez email-a).
 * `discoverable` = „uslovni“ tok: server ne zna korisnika, autentifikator ga
 * izabere iz svog `userHandle`-a. Sesija se postavlja u HttpOnly cookie.
 */
export async function loginWithPasskey(): Promise<{ user: unknown; csrfToken: string }> {
  const begin = await authRequest<Record<string, any>>('/auth/passkeys/login/begin', {
    method: 'POST',
    body: JSON.stringify({}),
    skipRetry: true,
  });
  if (!begin.ok) throw Object.assign(new Error((begin.data as any)?.error ?? 'Prijava passkey-om nije dostupna.'), begin.data);

  const credential = (await navigator.credentials.get({
    publicKey: toRequestOptions(begin.data.options),
  })) as PublicKeyCredential | null;
  if (!credential) throw Object.assign(new Error('Prijava je otkazana.'), { name: 'NotAllowedError' });

  const finish = await authRequest<{ user: unknown; csrfToken: string }>('/auth/passkeys/login/finish', {
    method: 'POST',
    body: JSON.stringify({ challengeId: begin.data.challengeId, credential: serializeCredential(credential) }),
    skipRetry: true,
  });
  if (!finish.ok) throw Object.assign(new Error((finish.data as any)?.error ?? 'Prijava nije uspela.'), finish.data);
  return finish.data;
}

/**
 * 3. Passkey kao DRUGI faktor (posle lozinke).
 * `options` dolaze uz `requires2fa` iz `/auth/login`.
 */
export async function login2faWithPasskey(mfaTicket: string, options: Record<string, any>) {
  const credential = (await navigator.credentials.get({
    publicKey: toRequestOptions(options),
  })) as PublicKeyCredential | null;
  if (!credential) throw Object.assign(new Error('Prijava je otkazana.'), { name: 'NotAllowedError' });

  const finish = await authRequest<{ user: unknown; csrfToken: string }>('/auth/passkeys/login/finish', {
    method: 'POST',
    body: JSON.stringify({
      challengeId: options.__challengeId,
      credential: serializeCredential(credential),
      // Server prihvata tiket kao dokaz prvog faktora.
      mfaTicket,
    }),
    skipRetry: true,
  });
  if (!finish.ok) throw Object.assign(new Error((finish.data as any)?.error ?? 'Prijava nije uspela.'), finish.data);
  return finish.data;
}

export const passkeysApi = {
  list: () => authRequest<{ passkeys: PasskeySummary[] }>('/auth/passkeys'),
  remove: (id: string) => authRequest<{ removed: boolean }>(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
