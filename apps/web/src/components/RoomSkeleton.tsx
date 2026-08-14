import { Wordmark } from './Chrome.js';

const COLUMNS = 4;
const ROWS = 10;

/**
 * The shape of the room, before the room arrives.
 *
 * A spinner where a grid is coming is a layout shift with extra steps: the page snaps into a
 * completely different arrangement the moment data lands. This holds the header, the grid and
 * the side panels at roughly their real proportions, so nothing jumps.
 */
export function RoomSkeleton(): React.JSX.Element {
  return (
    <div className="room" aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Opening the room…</p>

      <header className="room__header">
        <div className="room__brand">
          <Wordmark />
        </div>
        <div className="room__identity">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--zone" />
        </div>
        <div className="room__actions">
          <span className="skeleton skeleton--pill" />
        </div>
      </header>

      <main className="room__body">
        <section className="grid-panel" aria-hidden="true">
          <div className="grid-panel__toolbar">
            <span className="skeleton skeleton--pill" />
          </div>
          <div className="skeleton-grid">
            {Array.from({ length: COLUMNS * ROWS }, (_, index) => (
              <span
                className="skeleton skeleton--cell"
                key={index}
                // Staggered so the sheen reads as one surface filling in rather than a hundred
                // separate things blinking.
                style={{ animationDelay: `${String((index % COLUMNS) * 60)}ms` }}
              />
            ))}
          </div>
        </section>

        <aside className="room__aside" aria-hidden="true">
          <div className="panel">
            <span className="skeleton skeleton--label" />
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
          </div>
        </aside>
      </main>
    </div>
  );
}
