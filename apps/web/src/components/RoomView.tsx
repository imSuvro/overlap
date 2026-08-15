import { LEVEL, MAX_TITLE_LENGTH, type Level } from '@overlap/protocol';
import {
  buildViewerGrid,
  formatFullDate,
  formatTimeOfDay,
  localTimeZone,
  slotDurationMs,
} from '@overlap/time';
import { useMemo, useState } from 'react';
import { roomPath } from '../lib/api.js';
import { useRoom } from '../lib/useRoom.js';
import { AvailabilityGrid } from './AvailabilityGrid.js';
import { BestWindows } from './BestWindows.js';
import {
  ConnectionBadge,
  IconGlyph,
  OfflineNotice,
  ShareButton,
  StatusScreen,
  Toast,
  Wordmark,
} from './Chrome.js';
import { NameDialog } from './NameDialog.js';
import { ParticipantList } from './ParticipantList.js';
import { RoomSkeleton } from './RoomSkeleton.js';

const PAINT_MODES: readonly { level: Level; label: string; tone: 'free' | 'maybe' }[] = [
  { level: LEVEL.available, label: 'Free', tone: 'free' },
  { level: LEVEL.ifNeedBe, label: 'If need be', tone: 'maybe' },
];

export function RoomView({ roomId }: { roomId: string }): React.JSX.Element {
  const room = useRoom(roomId);
  const [paintLevel, setPaintLevel] = useState<Level>(LEVEL.available);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  // The viewer's own zone, always. The room's anchor zone defines what the host's chosen hours
  // mean; it never decides how anyone else reads the grid.
  const viewerZone = useMemo(() => localTimeZone(), []);

  const grid = useMemo(() => buildViewerGrid(room.slots, viewerZone), [room.slots, viewerZone]);

  const { finalizedInstant, participants, participantId, slots, state, commitVersion } = room;

  /**
   * Has anyone marked anything at all?
   *
   * Drives the grid's empty state. Recomputed on `commitVersion` for the same reason the rest
   * of the derived state is: `RoomState` is mutable, so React cannot see a change by identity.
   */
  const marks = useMemo(() => {
    let mine = 0;
    let anyone = 0;
    for (const slot of slots) {
      let touched = false;
      for (const participant of participants) {
        if (state.levelFor(participant.participantId, slot.instant) === LEVEL.unavailable) continue;
        touched = true;
        if (participant.participantId === participantId) mine += 1;
      }
      if (touched) anyone += 1;
    }
    return { mine, anyone };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitVersion is the invalidation signal
  }, [slots, participants, state, participantId, commitVersion]);

  if (room.loading) return <RoomSkeleton />;

  if (room.unreachable) {
    return (
      <StatusScreen
        tone="alert"
        title="We can't reach this room"
        body="Your connection dropped before the room could load. Nothing is lost — try again once you're back online."
        actions={
          <>
            <button type="button" className="button" onClick={room.retry}>
              Try again
            </button>
            <a className="button button--secondary" href="/">
              Start a new room
            </a>
          </>
        }
      />
    );
  }

  if (room.missing || !room.config) {
    return (
      <StatusScreen
        tone="alert"
        title="This room is gone"
        body="Either the link points somewhere that never existed, or the room was cleared after 60 days of quiet. Starting a new one takes about ten seconds."
        actions={
          <a className="button" href="/">
            Start a new room
          </a>
        }
      />
    );
  }

  if (room.myName.trim().length === 0) {
    return <NameDialog title={room.title} onSubmit={room.setName} />;
  }

  const shareUrl = `${location.origin}${roomPath(roomId)}`;
  const durationMs = slotDurationMs(room.config.slotMinutes);
  // An empty room is not a scheduling problem yet. It is an invitation problem, and until it is
  // solved painting your own availability into a room nobody can see achieves nothing.
  const alone = participants.length <= 1;

  return (
    <div className="room">
      <a className="skip-link" href="#availability-grid">
        Skip to the availability grid
      </a>

      <header className="room__header">
        <div className="room__brand">
          <Wordmark />
        </div>

        <div className="room__identity">
          <label className="visually-hidden" htmlFor="room-title">
            Room name — everyone in the room sees this
          </label>
          <div className="room__title-wrap">
            <input
              id="room-title"
              className="room__title-input"
              value={titleDraft ?? room.title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => {
                setTitleDraft(event.target.value);
              }}
              onBlur={() => {
                // Commit the trimmed value, not the draft: the comparison already trims, so
                // sending the raw draft would push stray whitespace into shared room state.
                const next = titleDraft?.trim() ?? '';
                if (next.length > 0 && next !== room.title) room.setTitle(next);
                setTitleDraft(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setTitleDraft(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="room__title-hint" aria-hidden="true">
              Rename
            </span>
          </div>
          <span className="room__zone">Your timezone · {viewerZone.replace(/_/g, ' ')}</span>
        </div>

        <div className="room__actions">
          <ConnectionBadge status={room.status} pendingCount={room.pendingCount} />
          <ShareButton url={shareUrl} variant="secondary" />
        </div>
      </header>

      <main className="room__body">
        {finalizedInstant !== null && (
          <div className="finalized">
            <span className="finalized__mark" aria-hidden="true">
              <IconGlyph name="pin" />
            </span>
            <div>
              <div className="finalized__label">Everyone&rsquo;s time</div>
              <div className="finalized__when">
                {formatFullDate(finalizedInstant, viewerZone)} ·{' '}
                {formatTimeOfDay(finalizedInstant, viewerZone)} –{' '}
                {formatTimeOfDay(finalizedInstant + durationMs, viewerZone)}
              </div>
            </div>
            <div className="finalized__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  room.finalize(null);
                }}
              >
                Unpin
              </button>
            </div>
          </div>
        )}

        <section className="grid-panel" id="availability-grid" aria-label="Your availability">
          <div className="grid-panel__toolbar">
            <div className="paint-modes" role="group" aria-label="What painting marks">
              {PAINT_MODES.map((mode) => (
                <button
                  key={mode.level}
                  type="button"
                  className="paint-modes__option"
                  aria-pressed={paintLevel === mode.level}
                  onClick={() => {
                    setPaintLevel(mode.level);
                  }}
                >
                  <span className={`paint-modes__swatch paint-modes__swatch--${mode.tone}`} />
                  {mode.label}
                </button>
              ))}
            </div>
            {/*
              Only once there is something to clear. While the grid is empty the invitation
              card is already saying "drag across the times you're free" in the middle of the
              grid, and saying it twice on one screen reads as a page that is not listening.
            */}
            {marks.mine > 0 && (
              <p className="grid-panel__lede">Drag again over the same times to clear them.</p>
            )}
          </div>

          <div className="grid-panel__stage">
            <AvailabilityGrid
              grid={grid}
              state={room.state}
              participants={participants}
              participantId={participantId}
              slotMinutes={room.config.slotMinutes}
              viewerZone={viewerZone}
              paintLevel={paintLevel}
              finalizedInstant={finalizedInstant}
              peers={room.peers}
              commitVersion={commitVersion}
              onPaint={room.setLevels}
              onBeginDrag={room.beginDrag}
              onEndDrag={room.endDrag}
              onCursor={room.sendCursor}
            />

            {/*
              The invitation sits over the grid rather than under it, because that is where the
              hand already is. `pointer-events: none` so the very drag it is asking for passes
              straight through it, and it leaves the moment the first cell is painted.
            */}
            {marks.anyone === 0 && (
              <div className="grid-invite" aria-hidden="true">
                <span className="grid-invite__card">Drag across the times you&rsquo;re free</span>
              </div>
            )}
          </div>

          <div className="grid-legend">
            <span className="grid-legend__ramp">
              <span>Nobody free</span>
              <span className="grid-legend__chips">
                {[0, 1, 2, 3, 4, 5].map((step) => (
                  <span key={step} className={`grid-legend__chip grid-legend__chip--${step}`} />
                ))}
              </span>
              <span>Everyone free</span>
            </span>
            <span className="grid-legend__mine">Your own picks are outlined</span>

            <details className="keyboard-help">
              <summary className="keyboard-help__summary">Keyboard shortcuts</summary>
              <ul className="keyboard-help__list">
                <li>
                  <kbd>Tab</kbd> moves into the grid
                </li>
                <li>
                  <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> move between times
                </li>
                <li>
                  <kbd>Space</kbd> marks or clears the time you&rsquo;re on
                </li>
                <li>
                  <kbd>Shift</kbd> with an arrow marks a whole block
                </li>
              </ul>
            </details>
          </div>
        </section>

        <aside className="room__aside">
          {/*
            The invitation lives in the side rail, not above the grid.

            Above the grid it disappeared the instant a second person joined — a remote event —
            and took ~100px of page with it, so the grid jumped under the hand of anyone
            mid-drag. A layout shift the user did not cause is a defect on its own; that it also
            silently dropped painted cells is what made it obvious.
          */}
          {alone && (
            <section className="invite" aria-labelledby="invite-title">
              <h2 className="invite__title" id="invite-title">
                You&rsquo;re the only one here
              </h2>
              <p className="invite__body">
                Send this link to everyone you&rsquo;re planning with. They can open it and start
                marking times straight away — no account, no install.
              </p>
              <ShareButton url={shareUrl} variant="large" />
            </section>
          )}

          <BestWindows
            state={room.state}
            slots={slots}
            participants={participants}
            slotMinutes={room.config.slotMinutes}
            viewerZone={viewerZone}
            finalizedInstant={finalizedInstant}
            onFinalize={room.finalize}
          />
          <ParticipantList
            participants={participants}
            peers={room.peers}
            state={room.state}
            slots={slots}
            participantId={participantId}
            slotMinutes={room.config.slotMinutes}
          />
        </aside>
      </main>

      {/*
        Outside `main`, and fixed rather than in flow.

        Losing the network is a remote event. As a normal row above the grid this banner pushed
        the grid down about 100px the instant the socket dropped, so a drag in progress finished
        four rows from where it started. Nothing that appears on someone else's schedule may
        occupy layout above the thing the user is currently dragging on.
      */}
      <OfflineNotice
        status={room.status}
        pendingCount={room.pendingCount}
        everConnected={room.everConnected}
      />

      {room.notice !== null && <Toast message={room.notice} onDismiss={room.dismissNotice} />}
    </div>
  );
}
