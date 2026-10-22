import { describe, expect, it } from 'vitest';
import { validate, createThreadSchema, createReplySchema, updatePostSchema, rolePatchSchema } from '../lib/schemas.js';

describe('createThreadSchema', () => {
  it('prihvata ispravnu temu', () => {
    const result = validate(createThreadSchema, { title: 'Novi build', content: 'Tekst teme' });
    expect(result.success).toBe(true);
  });

  it('odbija prekratak naslov', () => {
    const result = validate(createThreadSchema, { title: 'ab', content: 'Tekst teme' });
    expect(result.success).toBe(false);
  });

  it('odbija sadržaj preko 20.000 karaktera', () => {
    const result = validate(createThreadSchema, { title: 'Naslov', content: 'x'.repeat(20_001) });
    expect(result.success).toBe(false);
  });

  it('dozvoljava najviše 5 tagova', () => {
    const ok = validate(createThreadSchema, { title: 'Naslov', content: 'Telo', tags: ['a', 'b', 'c', 'd', 'e'] });
    const tooMany = validate(createThreadSchema, {
      title: 'Naslov',
      content: 'Telo',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(ok.success).toBe(true);
    expect(tooMany.success).toBe(false);
  });
});

describe('createReplySchema', () => {
  it('zahteva sadržaj', () => {
    expect(validate(createReplySchema, { content: '' }).success).toBe(false);
    expect(validate(createReplySchema, { content: 'Odgovor' }).success).toBe(true);
  });
});

describe('updatePostSchema', () => {
  it('odbija prazan patch', () => {
    expect(validate(updatePostSchema, {}).success).toBe(false);
  });

  it('prihvata izmenu sadržaja', () => {
    expect(validate(updatePostSchema, { content: 'Izmenjen tekst' }).success).toBe(true);
  });

  it('prihvata soft delete flag', () => {
    expect(validate(updatePostSchema, { deletePost: true }).success).toBe(true);
  });
});

describe('rolePatchSchema', () => {
  it('zahteva razlog kada je korisnik banovan', () => {
    expect(validate(rolePatchSchema, { isBanned: true }).success).toBe(false);
    expect(validate(rolePatchSchema, { isBanned: true, banReason: 'Spam' }).success).toBe(true);
  });

  it('dozvoljava promenu role bez bana', () => {
    expect(validate(rolePatchSchema, { role: 'moderator' }).success).toBe(true);
  });
});
