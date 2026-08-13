import { MAX_ROOM_DATES, MAX_TITLE_LENGTH, type RoomDraft } from '@overlap/protocol';
import { addDays, localDateAt, localTimeZone, parseLocalDate, toLocalDate } from '@overlap/time';
import { useMemo, useState } from 'react';
import { createRoom, roomPath } from '../lib/api.js';
import { Wordmark } from './Chrome.js';

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatHour(hour: number): string {
  if (hour === 0) return 'Midnight';
  if (hour === 12) return 'Noon';
  if (hour === 24) return 'Midnight';
  return hour < 12 ? `${String(hour)} am` : `${String(hour - 12)} pm`;
}

interface MonthCell {
  readonly date: string;
  readonly day: number;
  readonly inMonth: boolean;
}

/** Monday-first month grid, padded to whole weeks so the columns line up under the headers. */
function monthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1, 1);
  first.setUTCHours(0, 0, 0, 0);

  const leading = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - leading * 86_400_000);

  return Array.from({ length: 42 }, (_, index) => {
    const cursor = new Date(start.getTime() + index * 86_400_000);
    return {
      date: toLocalDate({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
      }),
      day: cursor.getUTCDate(),
      inMonth: cursor.getUTCMonth() + 1 === month,
    };
  });
}

export function Landing(): React.JSX.Element {
  const zone = useMemo(() => localTimeZone(), []);
  const today = useMemo(() => localDateAt(Date.now(), zone), [zone]);

  const [title, setTitle] = useState('');
  const [dates, setDates] = useState<string[]>(() => [today, addDays(today, 1), addDays(today, 2)]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60>(30);
  const [monthOffset, setMonthOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visibleMonth = useMemo(() => {
    const parsed = parseLocalDate(today);
    const zeroBased = parsed.month - 1 + monthOffset;
    return {
      year: parsed.year + Math.floor(zeroBased / 12),
      month: (((zeroBased % 12) + 12) % 12) + 1,
    };
  }, [today, monthOffset]);

  const cells = useMemo(() => monthGrid(visibleMonth.year, visibleMonth.month), [visibleMonth]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        Date.UTC(visibleMonth.year, visibleMonth.month - 1, 1),
      ),
    [visibleMonth],
  );

  const canSubmit =
    title.trim().length > 0 && dates.length > 0 && startHour < endHour && !submitting;

  function toggleDate(date: string): void {
    setDates((current) => {
      if (current.includes(date)) return current.filter((entry) => entry !== date);
      if (current.length >= MAX_ROOM_DATES) return current;
      return [...current, date].sort();
    });
  }

  async function submit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const draft: RoomDraft = {
        title: title.trim(),
        anchorZone: zone,
        dates: [...dates].sort(),
        dayStartMinute: startHour * 60,
        dayEndMinute: endHour * 60,
        slotMinutes,
      };
      const created = await createRoom(draft);
      // A full navigation rather than a history push: the room is a different application
      // shell, and this way a hard refresh of the resulting URL is exercised from the start.
      location.assign(roomPath(created.config.roomId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing__inner">
        <header className="landing__hero">
          <Wordmark size="lg" />
          <h1 className="landing__title">Find a time that works for everyone</h1>
          <p className="landing__subtitle">
            Share one link. Everyone paints when they&rsquo;re free, in their own timezone, and the
            overlap appears as you go. No accounts, no install.
          </p>
        </header>

        <form
          className="card create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="room-title-input">
              What are you planning?
            </label>
            <input
              id="room-title-input"
              className="input"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="Team retro, dinner with friends, standup…"
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>

          <div className="date-picker">
            <div className="create-form__footer">
              <span className="field__label">Which days?</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="button button--ghost"
                  aria-label="Previous month"
                  disabled={monthOffset === 0}
                  onClick={() => {
                    setMonthOffset((offset) => Math.max(0, offset - 1));
                  }}
                >
                  ←
                </button>
                <span style={{ minWidth: '9rem', textAlign: 'center', fontWeight: 600 }}>
                  {monthLabel}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  aria-label="Next month"
                  onClick={() => {
                    setMonthOffset((offset) => Math.min(11, offset + 1));
                  }}
                >
                  →
                </button>
              </span>
            </div>

            <div
              className="date-picker__grid"
              role="group"
              aria-label="Choose the days to consider"
            >
              {WEEKDAYS.map((weekday) => (
                <div className="date-picker__weekday" key={weekday} aria-hidden="true">
                  {weekday}
                </div>
              ))}
              {cells.map((cell) => {
                const selected = dates.includes(cell.date);
                const past = cell.date < today;
                return (
                  <button
                    key={cell.date}
                    type="button"
                    className={`date-picker__day${cell.inMonth ? '' : ' date-picker__day--outside'}`}
                    aria-pressed={selected}
                    aria-label={cell.date}
                    disabled={past}
                    onClick={() => {
                      toggleDate(cell.date);
                    }}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            <p className="field__hint">
              {dates.length === 0
                ? 'Pick at least one day.'
                : `${String(dates.length)} day${dates.length === 1 ? '' : 's'} selected.`}
            </p>
          </div>

          <div className="create-form__row">
            <div className="field">
              <label className="field__label" htmlFor="start-hour">
                From
              </label>
              <select
                id="start-hour"
                className="select"
                value={startHour}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setStartHour(next);
                  if (next >= endHour) setEndHour(Math.min(24, next + 1));
                }}
              >
                {HOURS.slice(0, 24).map((hour) => (
                  <option key={hour} value={hour}>
                    {formatHour(hour)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="end-hour">
                To
              </label>
              <select
                id="end-hour"
                className="select"
                value={endHour}
                onChange={(event) => {
                  setEndHour(Number(event.target.value));
                }}
              >
                {HOURS.filter((hour) => hour > startHour).map((hour) => (
                  <option key={hour} value={hour}>
                    {formatHour(hour)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="slot-size">
                In blocks of
              </label>
              <select
                id="slot-size"
                className="select"
                value={slotMinutes}
                onChange={(event) => {
                  setSlotMinutes(Number(event.target.value) as 15 | 30 | 60);
                }}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </div>

          <p className="field__hint">
            Your hours are set in <strong>{zone.replace(/_/g, ' ')}</strong>. Everyone else will see
            the same moments in their own timezone.
          </p>

          {error !== null && <p className="error-text">{error}</p>}

          <div className="create-form__footer">
            <button type="submit" className="button" disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create the room'}
            </button>
          </div>
        </form>

        <section className="landing__how" aria-label="How it works">
          {[
            {
              title: 'Pick your days',
              body: 'Choose the dates and hours worth considering. That is the whole setup.',
            },
            {
              title: 'Share the link',
              body: 'The URL is the room. Anyone who opens it can join — no account, no install.',
            },
            {
              title: 'Watch the overlap',
              body: 'Everyone paints when they are free. The busiest times darken as you go.',
            },
          ].map((step, index) => (
            <article className="card how-step" key={step.title}>
              <span className="how-step__number">{index + 1}</span>
              <h2 className="how-step__title">{step.title}</h2>
              <p className="how-step__body">{step.body}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
