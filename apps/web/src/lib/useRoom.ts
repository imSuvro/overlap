import type { Cursor, Level, Participant, Presence, RoomConfig } from '@overlap/protocol';
import { RoomClient, RoomState, type ConnectionStatus } from '@overlap/room-core';
import { materializeSlots, type Slot } from '@overlap/time';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRoom, socketUrl } from './api.js';
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
  /**
   * Whether this session has ever had a live socket.
   *
   * Status starts at `offline` because that is literally true before the first connection, but
   * "offline" is the wrong thing to *tell* someone who has simply not connected yet.
   */
  readonly everConnected: boolean;
  readonly notice: string | null;
  readonly loading: boolean;
  /** The API answered 404. The room is definitely not there. */
  readonly missing: boolean;
  /** The API could not be reached at all and nothing was cached. Absence is *not* proven. */
  readonly unreachable: boolean;
  readonly retry: () => void;
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
  const [everConnected, setEverConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [client, setClient] = useState<RoomClient | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setUnreachable(false);
    setLoading(true);
    setAttempt((count) => count + 1);
  }, []);

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

    /*
     * Read through a call, not directly.
     *
     * `disposed` only ever flips in the cleanup, which the compiler cannot see from inside
     * `boot`, so after the first `if (disposed) return` it narrows the flag to `false` for the
     * rest of the function and every later check becomes provably dead code. Going through a
     * function returns an un-narrowed boolean, which is the truth: any `await` below can be
     * resumed after this effect has been torn down.
     */
    const isDisposed = (): boolean => disposed;

    async function boot(): Promise<void> {
      const [cached, outbox] = await Promise.all([loadCachedRoom(roomId), loadOutbox(roomId)]);
      if (isDisposed()) return;

      // A cached room renders instantly and offline; the socket then merges the authoritative
      // view on top. There is no "loading over stale data" state to manage because merging is
      // the same operation either way.
      if (cached) setConfig(cached.config);

      /*
       * With nothing cached, settle whether the room exists *before* opening a socket.
       *
       * Absence used to be inferred from a socket that had not connected within four seconds,
       * which meant a dead room sat there reopening a WebSocket against a 404 forever. Asking
       * the API is a definite answer in one round trip, and asking it first means no socket is
       * ever opened only to be torn down mid-handshake.
       *
       * The cached path deliberately skips this and connects immediately: offline-first is the
       * point, and a cache is a better thing to show than a spinner.
       */
      if (!cached) {
        try {
          const found = await fetchRoom(roomId);
          if (isDisposed()) return;
          if (!found) {
            setMissing(true);
            setLoading(false);
            return;
          }
          setConfig(found.config);
        } catch {
          // Unreachable is not the same as absent — the user may simply be on a train — so this
          // is an error to recover from, never "this room does not exist".
          if (isDisposed()) return;
          setUnreachable(true);
          setLoading(false);
          return;
        }
      }
      if (isDisposed()) return;

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
          if (next === 'live') {
            setMissing(false);
            setEverConnected(true);
          }
        },
        onPresenceChange: (next) => {
          setPeers(next);
        },
        onChange: () => {
          bumpCommit();

          // Driven off every change, local or remote, so painting with no network still
          // reaches the disk. Building a snapshot is O(entries), so it is done once when the
          // writes settle rather than on each painted cell.
          if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = window.setTimeout(() => {
            const roomConfig = created?.config ?? cached?.config;
            if (created && roomConfig) {
              void saveCachedRoom(roomId, roomConfig, created.state.toSnapshot());
            }
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

      // Rendering from a cache is a promise that the cache is still true. Confirming it in the
      // background costs nothing and keeps a swept room from looking alive indefinitely.
      if (cached) {
        void fetchRoom(roomId).then(
          (found) => {
            if (isDisposed()) return;
            if (found) {
              setConfig(found.config);
              return;
            }
            /*
             * A definite 404 against a room we are rendering from cache. The room was swept, so
             * nothing in the outbox can ever be delivered and every further socket attempt is
             * wasted. Acting on this is the entire reason the confirmation exists — dropping the
             * null left a dead room looking alive for as long as the tab stayed open.
             */
            setMissing(true);
            roomClient.stop();
          },
          () => {
            // Offline with a cache is the case this whole design exists to serve. Nothing to do.
          },
        );
      }
    }

    void boot();

    return () => {
      disposed = true;
      created?.stop();
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      if (snapshotTimerRef.current !== null) window.clearTimeout(snapshotTimerRef.current);
    };
  }, [roomId, identity.participantId, bumpCommit, attempt]);

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
    const onOffline = (): void => {
      client.notifyNetworkLost();
    };

    window.addEventListener('online', wake);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client]);

  /*
   * Recover from an unreachable boot without being asked.
   *
   * When the very first probe fails there is no client yet, so the reconnection loop above has
   * nothing to wake — the screen would sit on "we can't reach this room" until the button was
   * pressed, where previously the room appeared on its own once the signal came back. Someone
   * who opened the link in a tunnel puts the phone away and takes it out again; it should be
   * loaded.
   */
  useEffect(() => {
    if (!unreachable) return;
    const onOnline = (): void => {
      retry();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && navigator.onLine) retry();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [unreachable, retry]);

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

  /*
   * A remembered name has to actually join the room, not merely satisfy the prompt.
   *
   * `identity.name` is one global value, not per room. The join gate reads it and skips the
   * dialog for anyone who has used the product before — but `setName` is only ever called from
   * that dialog, so from a returning visitor's *second* room onwards no name register was ever
   * written. They are then absent from `RoomState.participants()`, which is what the
   * participant list, the best-times scoring, the heat fill and the "N other people free"
   * labels all enumerate. Their marks were stored and drawn back to them as outlines while
   * being invisible to the room's own arithmetic — including to everybody else.
   *
   * Writing the register once on arrival restores the invariant the name gate exists to
   * guarantee: every mark on the grid belongs to a named person.
   */
  const autoJoinedRef = useRef(false);

  useEffect(() => {
    if (!client || autoJoinedRef.current) return;

    const remembered = identity.name.trim();
    if (remembered.length === 0) return;

    const alreadyRegistered = derived.participants.some(
      (participant) => participant.participantId === identity.participantId,
    );
    autoJoinedRef.current = true;
    if (alreadyRegistered) return;

    client.setName(remembered);
    setCommitVersion((version) => version + 1);
  }, [client, derived.participants, identity.name, identity.participantId]);

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
    everConnected,
    notice,
    loading,
    missing,
    unreachable,
    retry,
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
