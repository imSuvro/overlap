export {
  ROOM_ID_LENGTH,
  PARTICIPANT_ID_LENGTH,
  SESSION_ID_LENGTH,
  generateId,
  generateParticipantId,
  generateRoomId,
  generateSessionId,
  hueForParticipant,
  isWellFormedId,
} from './ids.js';

export type {
  Cursor,
  Level,
  Participant,
  Presence,
  RoomConfig,
  RoomDraft,
  SettingKey,
  SettingValue,
} from './domain.js';
export {
  LEVEL,
  LEVEL_WEIGHT,
  MAX_NAME_LENGTH,
  MAX_ROOM_DATES,
  MAX_ROOM_SLOTS,
  MAX_TITLE_LENGTH,
  SETTING_KEYS,
  availabilityKey,
  cursorSchema,
  levelSchema,
  localDateSchema,
  parseAvailabilityKey,
  participantIdSchema,
  participantSchema,
  presenceSchema,
  roomConfigSchema,
  roomDraftSchema,
  roomIdSchema,
  sessionIdSchema,
  settingKeySchema,
  settingValueSchema,
  slotMinutesSchema,
  timeZoneSchema,
} from './domain.js';

export type {
  ClientMessage,
  CreateRoomResponse,
  ErrorCode,
  Op,
  ParseResult,
  RoomSnapshot,
  ServerMessage,
} from './messages.js';
export {
  MAX_MESSAGE_BYTES,
  MAX_OPS_PER_MESSAGE,
  clientMessageSchema,
  createRoomResponseSchema,
  encodeClientMessage,
  encodeServerMessage,
  errorCodeSchema,
  opSchema,
  parseClientMessage,
  parseServerMessage,
  roomSnapshotSchema,
  serverMessageSchema,
} from './messages.js';

export type { CachedRoom, OutboxEntry, PersistedIdentity, PersistedRoom } from './storage.js';
export {
  cachedRoomSchema,
  outboxEntrySchema,
  parseStored,
  persistedIdentitySchema,
  persistedRoomSchema,
} from './storage.js';
