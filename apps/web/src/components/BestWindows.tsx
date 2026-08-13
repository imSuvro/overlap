import type { Participant } from '@overlap/protocol';
import { findBestWindows, type RoomState } from '@overlap/room-core';
import { formatFullDate, formatTimeOfDay, type Slot, type SlotMinutes } from '@overlap/time';
import { useMemo } from 'react';

export interface BestWindowsProps {
  readonly state: RoomState;
  readonly slots: readonly Slot[];
  readonly participants: readonly Participant[];
  readonly slotMinutes: SlotMinutes;
  readonly viewerZone: string;
  readonly finalizedInstant: number | null;
  readonly onFinalize: (instant: number | null) => void;
}

/**
 * The answer to the question the room exists to ask.
 *
 * A participant counts toward a window only if they can make **all** of it, scored at their
 * worst level across the span — averaging per slot would cheerfully suggest an hour that half
 * the room can only attend the first twenty minutes of.
 */
export function BestWindows(props: BestWindowsProps): React.JSX.Element {
  const { state, slots, participants, slotMinutes, viewerZone } = props;

  const windows = useMemo(
    () =>
      findBestWindows({
        slots,
        state,
        participantIds: participants.map((participant) => participant.participantId),
        slotMinutes,
        limit: 3,
      }),
    [slots, state, participants, slotMinutes],
  );

  const nameOf = useMemo(() => {
    const lookup = new Map(participants.map((p) => [p.participantId, p.name]));
    return (id: string): string => lookup.get(id) ?? 'Someone';
  }, [participants]);

  if (participants.length === 0) {
    return (
      <section className="panel" aria-labelledby="best-windows-title">
        <h2 className="panel__title" id="best-windows-title">
          Best times
        </h2>
        <p className="panel__empty">
          Once people start marking their availability, the best times will show up here.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="best-windows-title">
      <h2 className="panel__title" id="best-windows-title">
        Best times
      </h2>

      {windows.length === 0 ? (
        <p className="panel__empty">No overlap yet. Paint some availability to get started.</p>
      ) : (
        <ol className="window-list">
          {windows.map((window, index) => {
            const isFinalized = props.finalizedInstant === window.startInstant;
            return (
              <li
                key={window.startInstant}
                className={`window-card${index === 0 ? ' window-card--top' : ''}`}
              >
                <div className="window-card__when">
                  {formatFullDate(window.startInstant, viewerZone)}
                  <br />
                  {formatTimeOfDay(window.startInstant, viewerZone)} –{' '}
                  {formatTimeOfDay(window.endInstant, viewerZone)}
                </div>

                <p className="window-card__who">
                  {window.available.length === participants.length ? (
                    <strong>Everyone can make it</strong>
                  ) : (
                    <>
                      {window.available.length} of {participants.length} free
                      {window.ifNeedBe.length > 0 && (
                        <>
                          {' · '}
                          {window.ifNeedBe.map(nameOf).join(', ')} at a push
                        </>
                      )}
                    </>
                  )}
                </p>

                <div className="window-card__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)' }}
                    onClick={() => {
                      props.onFinalize(isFinalized ? null : window.startInstant);
                    }}
                  >
                    {isFinalized ? 'Unpin' : 'Pin this time'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
