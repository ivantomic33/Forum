import { describe, expect, it } from 'vitest';
import { createActionToken, consumeActionToken, peekActionToken, clearActionTokens } from '../lib/actionTokens.js';

describe('action tokens', () => {
  it('kreira token i troši ga samo jednom', async () => {
    clearActionTokens();
    const { token } = await createActionToken('usr_test', 'verify_email');

    expect(await peekActionToken(token, 'verify_email')).toEqual({ userId: 'usr_test' });
    expect(await consumeActionToken(token, 'verify_email')).toEqual({ userId: 'usr_test' });
    // Drugi pokušaj mora da padne (jednokratni token)
    expect(await consumeActionToken(token, 'verify_email')).toBeNull();
  });

  it('odbija token pogrešnog tipa', async () => {
    clearActionTokens();
    const { token } = await createActionToken('usr_test', 'reset_password');
    expect(await consumeActionToken(token, 'verify_email')).toBeNull();
  });

  it('odbija nepostojeći token', async () => {
    clearActionTokens();
    expect(await consumeActionToken('nema-ovaj-token', 'verify_email')).toBeNull();
  });

  it('ne prihvata izmenjen token', async () => {
    clearActionTokens();
    const { token } = await createActionToken('usr_test', 'reset_password');
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await consumeActionToken(tampered, 'reset_password')).toBeNull();
  });
});
