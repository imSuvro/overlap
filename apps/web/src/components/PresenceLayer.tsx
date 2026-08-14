import { hueForParticipant, type Presence } from '@overlap/protocol';
import { participantColour } from '../lib/palette.js';
import { usePrefersDark } from '../lib/usePrefersDark.js';

export interface PresenceLayerProps {
  readonly peers: readonly Presence[];
  readonly width: number;
  readonly height: number;
}

/**
 * Other people's cursors.
 *
 * Positions arrive as normalised grid coordinates rather than pixels, so a pointer sitting on
 * Thursday 2pm lands on Thursday 2pm for everyone — regardless of window size, zoom, or the
 * fact that two viewers in different timezones have differently-shaped grids.
 *
 * `translate` is animated rather than `left`/`top` so movement stays on the compositor and
 * never triggers layout. A short transition smooths the ~20 Hz update rate into something that
 * reads as a moving cursor instead of a blinking one.
 */
export function PresenceLayer({ peers, width, height }: PresenceLayerProps): React.JSX.Element {
  const dark = usePrefersDark();

  return (
    <div className="presence-layer" aria-hidden="true">
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const colour = participantColour(hueForParticipant(peer.participantId), dark);
        const x = peer.cursor.x * width;
        const y = peer.cursor.y * height;

        return (
          <div
            key={peer.sessionId}
            className="presence-cursor"
            style={{ translate: `${String(x)}px ${String(y)}px` }}
          >
            <svg className="presence-cursor__arrow" viewBox="0 0 14 18" fill="none">
              <path
                d="M1 1.2 12.4 9.6 6.9 10.3 4.2 15.6z"
                fill={colour}
                stroke="var(--surface)"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            {/*
              The participant's colour rings the chip rather than filling it. Filling it meant
              white text over a generated hue, and a hue is not a colour you can guarantee
              contrast against — yellow at the same lightness as blue is four times brighter.
              Ringing it keeps the identity signal and puts the label on a known surface.
            */}
            {peer.name.length > 0 && (
              <span className="presence-cursor__name" style={{ borderColor: colour }}>
                {peer.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
