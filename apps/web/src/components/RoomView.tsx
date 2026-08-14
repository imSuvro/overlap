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
import { ConnectionBadge, ShareButton, Toast, Wordmark } from './Chrome.js';
import { NameDialog } from './NameDialog.js';
import { ParticipantList } from './ParticipantList.js';

const PAINT_MODES: readonly { level: Level; label: string; swatch: string }[] = [
  { level: LEVEL.available, label: 'Free', swatch: 'var(--heat-4)' },
  { level: LEVEL.ifNeedBe, label: 'If need be', swatch: 'var(--heat-2)' },
];

export function RoomView({ roomId }: { roomId: string }): React.JSX.Element {
  const room = useRoom(roomId);
  const [paintLevel, setPaintLevel] = useState<Level>(LEVEL.available);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  // The viewer's own zone, always. The room's anchor zone defines what the host's chosen hours
  // mean; it never decides how anyone else reads the grid.
  const viewerZone = useMemo(() => localTimeZone(), []);

  const grid = useMemo(() => buildViewerGrid(room.slots, viewerZone), [room.slots, viewerZone]);

  const { finalizedInstant } = room;

  if (room.loading) {
    return (
      <div className="centered-message">
        <div className="centered-message__inner">
          <Wordmark size="lg" />
          <p style={{ color: 'var(--ink-soft)' }}>Opening the room…</p>
        </div>
      </div>
    );
  }

  if (room.missing || !room.config) {
    return (
      <div className="centered-message">
        <div className="centered-message__inner">
          <Wordmark size="lg" />
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-2xl)' }}>
            This room isn&rsquo;t here
          </h1>
          <p style={{ color: 'var(--ink-soft)' }}>
            The link may be mistyped, or the room may have been swept after 60 days without any
            activity.
          </p>
          <a className="button" href="/">
            Start a new room
          </a>
        </div>
      </div>
    );
  }

  if (room.myName.trim().length === 0) {
    return <NameDialog title={room.title} onSubmit={room.setName} />;
  }

  const shareUrl = `${location.origin}${roomPath(roomId)}`;
  const durationMs = slotDurationMs(room.config.slotMinutes);

  return (
    <div className="room">
      <a className="skip-link" href="#availability-grid">
        Skip to the availability grid
      </a>

      <header className="room__header">
        <Wordmark />

        <div className="room__identity">
          <label className="visually-hidden" htmlFor="room-title">
            Room name
          </label>
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
          <span className="room__zone">
            Shown in your timezone · {viewerZone.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="room__actions">
          <ConnectionBadge status={room.status} pendingCount={room.pendingCount} />
          <ShareButton url={shareUrl} />
        </div>
      </header>

      <main className="room__body">
        {finalizedInstant !== null && (
          <div className="finalized">
            <div>
              <div className="finalized__label">Pinned</div>
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
                  <span className="paint-modes__swatch" style={{ background: mode.swatch }} />
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <AvailabilityGrid
            grid={grid}
            state={room.state}
            participants={room.participants}
            participantId={room.participantId}
            slotMinutes={room.config.slotMinutes}
            viewerZone={viewerZone}
            paintLevel={paintLevel}
            finalizedInstant={finalizedInstant}
            peers={room.peers}
            commitVersion={room.commitVersion}
            onPaint={room.setLevels}
            onBeginDrag={room.beginDrag}
            onEndDrag={room.endDrag}
            onCursor={room.sendCursor}
          />

          <div className="grid-legend">
            <span className="grid-legend__ramp">
              <span>Nobody</span>
              <span className="grid-legend__chips">
                {[0, 1, 2, 3, 4, 5].map((step) => (
                  <span
                    key={step}
                    className="grid-legend__chip"
                    style={{ background: `var(--heat-${String(step)})` }}
                  />
                ))}
              </span>
              <span>Everyone</span>
            </span>
            <span>Your picks are outlined</span>
          </div>

          <p className="grid-hint">
            Drag to paint when you&rsquo;re free. Drag again over the same cells to clear them.
            Using a keyboard: Tab to the grid, arrow keys to move, Space to toggle, Shift with
            arrows to paint a block.
          </p>
        </section>

        <aside className="room__aside">
          <BestWindows
            state={room.state}
            slots={room.slots}
            participants={room.participants}
            slotMinutes={room.config.slotMinutes}
            viewerZone={viewerZone}
            finalizedInstant={finalizedInstant}
            onFinalize={room.finalize}
          />
          <ParticipantList
            participants={room.participants}
            peers={room.peers}
            state={room.state}
            slots={room.slots}
            participantId={room.participantId}
          />
        </aside>
      </main>

      {room.notice !== null && <Toast message={room.notice} onDismiss={room.dismissNotice} />}
    </div>
  );
}
