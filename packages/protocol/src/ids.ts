/**
 * Base58 — the Bitcoin alphabet. No `0`, `O`, `I`, or `l`, so a room id read aloud over a call
 * or copied out of a screenshot does not turn into a different room.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** 256 is not a multiple of 58; bytes at or above this would be over-represented. */
const REJECTION_THRESHOLD = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export const ROOM_ID_LENGTH = 22;
export const PARTICIPANT_ID_LENGTH = 16;
export const SESSION_ID_LENGTH = 12;

/**
 * A cryptographically random identifier.
 *
 * The URL *is* the room, so the room id is the only thing standing between a stranger and
 * someone's calendar. 22 base58 characters is about 128 bits — not guessable, and short enough
 * to sit in a link people paste into group chats.
 *
 * Rejection sampling rather than plain modulo: a biased alphabet quietly costs entropy, which
 * is the one property this identifier exists to have.
 */
export function generateId(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError('Identifier length must be a positive integer');
  }

  let out = '';
  // Over-sample so a run of rejected bytes rarely needs a second call into the CSPRNG.
  const buffer = new Uint8Array(length * 2);

  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= REJECTION_THRESHOLD) continue;
      const character = ALPHABET[byte % ALPHABET.length];
      if (character === undefined) continue;
      out += character;
      if (out.length === length) break;
    }
  }

  return out;
}

export const generateRoomId = (): string => generateId(ROOM_ID_LENGTH);
export const generateParticipantId = (): string => generateId(PARTICIPANT_ID_LENGTH);
export const generateSessionId = (): string => generateId(SESSION_ID_LENGTH);

const ID_PATTERN = new RegExp(`^[${ALPHABET}]+$`);

export function isWellFormedId(value: string, length: number): boolean {
  return value.length === length && ID_PATTERN.test(value);
}

/**
 * A stable hue for a participant, derived from their id rather than assigned by the server.
 *
 * Deriving it means every client computes the same colour for the same person with no
 * coordination, no colour-allocation state in the CRDT, and no chance of two replicas
 * disagreeing about who is teal.
 */
export function hueForParticipant(participantId: string): number {
  // FNV-1a — small, fast, and well-distributed over short strings.
  let hash = 0x811c9dc5;
  for (let i = 0; i < participantId.length; i += 1) {
    hash ^= participantId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}
