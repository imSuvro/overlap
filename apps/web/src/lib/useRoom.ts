import type { Cursor, Level, Participant, Presence, RoomConfig } from '@overlap/protocol';
import { RoomClient, RoomState, type ConnectionStatus } from '@overlap/room-core';
import { materializeSlots, type Slot } from '@overlap/time';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socketUrl } from './api.js';
import { loadIdentity, rememberName, sessionId } from './identity.js';
import { loadCachedRoom, loadOutbox, saveCachedRoom, saveOutbox } from './storage.js';

export interface RoomSession {
  readonly status: ConnectionStatus;
  readonly config: RoomConfig | null;
  readonly slots: readonly Slot[];
  readonly title: string;
  readonly participants: readonly Participant[];
  readonly finalizedInstant: number | null;
  readonly peers: readonly Presence[];
  readonly state: RoomState;
  readonly participantId: string;
  readonly myName: string;
  readonly pendingCount: number;
  readonly notice: string | null;
  readonly loading: boolean;
  readonly missing: boolean;
  /**
   * Bumps whenever the *labels* need to change. Held still during a drag, so the
   * accessibility layer is not rewritten sixty times a second over an interaction that has
   * not finished.
   */
  readonly commitVersion: number;
  readonly beginDrag: () => void;
  readonly endDrag: () => void;
  readonly setLevels: (entries: readonly { instant: number; level: Level }[]) => void;
  readonly setName: (name: string) => void;
  readonly setTitle: (title: string) => void;
  readonly finalize: (instant: number | null) => void;
  readonly sendCursor: (cursor: Cursor | null, hoveredInstant: number | null) => void;
  readonly dismissNotice: () => void;
}

/** How long panels may lag behind a burst of remote edits. Imperceptible, and bounds re-renders. */
const COMMIT_DEBOUNCE_MS = 90;
const SNAPSHOT_DEBOUNCE_MS = 800;

/**
 * Wires {@link RoomClient} to React, IndexedDB, and the browser's connectivity signals.
 *
 * The interesting part is what does *not* re-render. Painting mutates the CRDT dozens of times
 * a second; letting each of those flow into React would re-render the panels and the ~700-node
 * accessibility layer mid-drag. Instead the canvas repaints itself from the live state on its
 * own animation frame, and React is only nudged when something has actually settled.
 */
export function useRoom(roomId: string): RoomSession {
  const identity = useMemo(() => loadIdentity(), []);

  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [peers, setPeers] = useState<readonly Presence[]>([]);
  const [commitVersion, setCommitVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [client, setClient] = useState<RoomClient | null>(null);

  const draggingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);

  const bumpCommit = useCallback(() => {
    if (commitTimerRef.current !== null) return;
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      // A drag still in flight means the labels are about to change again; wait for it to end
      // rather than rewriting them mid-gesture.
      if (draggingRef.current) return;
      setCommitVersion((version) => version + 1);
    }, COMMIT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let disposed = false;
    let created: RoomClient | null = null;

    async function boot(): Promise<void> {
      const [cached, outbox] = await Promise.all([loadCachedRoom(roomId), loadOutbox(roomId)]);
      if (disposed) return;

      // A cached room renders instantly and offline; the socket then merges the authoritative
      // view on top. There is no "loading over stale data" state to manage because merging is
      // the same operation either way.
      if (cached) setConfig(cached.config);

      const roomClient = new RoomClient({
        participantId: identity.participantId,
        sessionId: sessionId(),
        initialSnapshot: cached?.snapshot,
        initialOutbox: outbox,
        connect: (handlers) => {
          const socket = new WebSocket(socketUrl(roomId));
          socket.onopen = () => {
            handlers.onOpen();
          };
          socket.onmessage = (event) => {
            if (typeof event.data === 'string') handlers.onMessage(event.data);
          };
          socket.onclose = () => {
            handlers.onClose();
          };
          socket.onerror = () => {
            // `close` always follows, and that is where reconnection is scheduled.
          };
          return {
            send: (payload) => {
              if (socket.readyState === WebSocket.OPEN) socket.send(payload);
            },
            close: () => {
              socket.close();
            },
          };
        },
        onStatusChange: (next) => {
          setStatus(next);
          if (next === 'live') setMissing(false);
        },
        onPresenceChange: (next) => {
          setPeers(next);
        },
        onChange: bumpCommit,
        onSnapshot: (snapshot) => {
          if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = window.setTimeout(() => {
            const current = created?.config;
            if (current) void saveCachedRoom(roomId, current, snapshot);
          }, SNAPSHOT_DEBOUNCE_MS);
        },
        onOutboxChange: (ops) => {
          setPendingCount(ops.length);
          void saveOutbox(roomId, ops);
        },
        onRejected: (reason) => {
          setNotice(reason);
        },
      });

      created = roomClient;
      roomClient.start();
      setClient(roomClient);
      setLoading(false);

      // If the socket never comes up and nothing was cached, the room genuinely may not exist.
      window.setTimeout(() => {
        if (!disposed && roomClient.config === null && !cached) setMissing(true);
      }, 4_000);
    }

    void boot();

    return () => {
      disposed = true;
      created?.stop();
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    };
  }, [roomId, identity.participantId, bumpCommit]);

  // Adopt the config the moment the socket delivers it.
  useEffect(() => {
    if (client?.config) setConfig(client.config);
  }, [client, commitVersion]);

  /*
   * Browsers suspend timers in background tabs, so the backoff schedule alone can leave a
   * reconnect minutes late after a phone is unlocked. These two signals cover the cases that
   * actually happen: switching back to the tab, and a network coming back.
   */
  useEffect(() => {
    if (!client) return;
    const wake = (): void => {
      if (client.status === 'offline') {
        client.stop();
        client.start();
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') wake();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client]);

  const slots = useMemo(() => (config ? materializeSlots(config).slots : []), [config]);

  /**
   * Derived views of the CRDT.
   *
   * `RoomState` is mutable by design — copy-on-write over tens of thousands of registers would
   * be O(n) per painted cell — so React cannot detect a change by identity. Recomputing when
   * `commitVersion` moves states the invalidation rule outright, rather than hiding it in a
   * dependency array the linter has no way to verify.
   */
  const [derived, setDerived] = useState<DerivedState>(EMPTY_DERIVED);

  useEffect(() => {
    if (!client) return;
    setDerived({
      participants: client.state.participants(),
      title: client.state.title(),
      finalizedInstant: client.state.finalizedInstant(),
    });
  }, [client, commitVersion]);

  const myName = useMemo(
    () => derived.participants.find((p) => p.participantId === identity.participantId)?.name ?? '',
    [derived.participants, identity.participantId],
  );

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setCommitVersion((version) => version + 1);
  }, []);

  const setLevels = useCallback(
    (entries: readonly { instant: number; level: Level }[]) => {
      client?.setLevels(entries);
    },
    [client],
  );

  const setName = useCallback(
    (name: string) => {
      rememberName(name);
      client?.setName(name);
      setCommitVersion((version) => version + 1);
    },
    [client],
  );

  const setTitle = useCallback(
    (next: string) => {
      client?.setTitle(next);
      setCommitVersion((version) => version + 1);
    },
    [client],
  );

  const finalize = useCallback(
    (instant: number | null) => {
      client?.finalize(instant);
      setCommitVersion((version) => version + 1);
    },
    [client],
  );

  const sendCursor = useCallback(
    (cursor: Cursor | null, hoveredInstant: number | null) => {
      client?.sendCursor(cursor, hoveredInstant);
    },
    [client],
  );

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return {
    status,
    config,
    slots,
    title: derived.title,
    participants: derived.participants,
    finalizedInstant: derived.finalizedInstant,
    peers,
    state: client?.state ?? EMPTY_STATE,
    participantId: identity.participantId,
    myName: myName === '' ? identity.name : myName,
    pendingCount,
    notice,
    loading,
    missing,
    commitVersion,
    beginDrag,
    endDrag,
    setLevels,
    setName,
    setTitle,
    finalize,
    sendCursor,
    dismissNotice,
  };
}

/** Stands in for the instant between mount and the client existing. */
const EMPTY_STATE = new RoomState();

interface DerivedState {
  readonly participants: readonly Participant[];
  readonly title: string;
  readonly finalizedInstant: number | null;
}

const EMPTY_DERIVED: DerivedState = { participants: [], title: '', finalizedInstant: null };
