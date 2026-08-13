import { LEVEL, hueForParticipant, type Participant, type Presence } from '@overlap/protocol';
import type { RoomState } from '@overlap/room-core';
import type { Slot } from '@overlap/time';
import { useMemo } from 'react';
import { participantColour } from '../lib/palette.js';
import { usePrefersDark } from '../lib/usePrefersDark.js';

export interface ParticipantListProps {
  readonly participants: readonly Participant[];
  readonly peers: readonly Presence[];
  readonly state: RoomState;
  readonly slots: readonly Slot[];
  readonly participantId: string;
}

export function ParticipantList(props: ParticipantListProps): React.JSX.Element {
  const { participants, peers, state, slots, participantId } = props;
  const dark = usePrefersDark();

  const onlineIds = useMemo(() => new Set(peers.map((peer) => peer.participantId)), [peers]);

  const marked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const participant of participants) {
      let count = 0;
      for (const slot of slots) {
        if (state.levelFor(participant.participantId, slot.instant) !== LEVEL.unavailable)
          count += 1;
      }
      counts.set(participant.participantId, count);
    }
    return counts;
  }, [participants, slots, state]);

  return (
    <section className="panel" aria-labelledby="participants-title">
      <h2 className="panel__title" id="participants-title">
        In this room ({participants.length})
      </h2>

      {participants.length === 0 ? (
        <p className="panel__empty">You&rsquo;re first. Share the link to invite people.</p>
      ) : (
        <ul className="participant-list">
          {participants.map((participant) => {
            const isMe = participant.participantId === participantId;
            const online = isMe || onlineIds.has(participant.participantId);
            const count = marked.get(participant.participantId) ?? 0;

            return (
              <li
                key={participant.participantId}
                className={`participant${isMe ? ' participant--me' : ''}`}
              >
                <span
                  className="participant__dot"
                  style={{
                    background: participantColour(
                      hueForParticipant(participant.participantId),
                      dark,
                    ),
                    // Dimmed rather than hidden: someone who painted last night and closed the
                    // tab is still part of the room, just not here right now.
                    opacity: online ? 1 : 0.35,
                  }}
                />
                <span className="participant__name">
                  {participant.name}
                  {isMe && ' (you)'}
                </span>
                <span className="participant__meta">
                  {count === 0 ? 'nothing yet' : `${String(count)} slot${count === 1 ? '' : 's'}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
