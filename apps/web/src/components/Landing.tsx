import { MAX_ROOM_DATES, MAX_TITLE_LENGTH, type RoomDraft } from '@overlap/protocol';
import { addDays, localDateAt, localTimeZone, parseLocalDate, toLocalDate } from '@overlap/time';
import { useMemo, useRef, useState } from 'react';
import { createRoom, roomPath } from '../lib/api.js';
import { IconGlyph, Wordmark } from './Chrome.js';
import { DemoGrid } from './DemoGrid.js';

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

const HOW_IT_WORKS = [
  {
    title: 'Pick the days worth considering',
    body: 'Choose your dates and a rough window of hours. That is the entire setup.',
  },
  {
    title: 'Send one link',
    body: 'The URL is the room. Anyone who opens it can join straight away — no account, no install, nothing to download.',
  },
  {
    title: 'Watch the answer appear',
    body: 'Everyone marks when they are free, in their own timezone. The times that suit the whole group darken as you go.',
  },
] as const;

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

  const titleRef = useRef<HTMLInputElement | null>(null);

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
      setError(
        cause instanceof Error
          ? `${cause.message}. Check your connection and try again — nothing you typed is lost.`
          : 'The room could not be created. Check your connection and try again — nothing you typed is lost.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="landing">
      <div className="landing__inner">
        {/*
          The hero shows the product before it asks for anything. The old page led with a
          headline and an empty text field, and put its only button 1,200px below the fold —
          so the first screen argued for setup it had not yet earned.
        */}
        <header className="hero">
          <div className="hero__text">
            <Wordmark size="lg" />
            <h1 className="hero__title">Find a time that works for everyone</h1>
            <p className="hero__subtitle">
              For the person who got stuck organising it. Share one link, everyone marks when
              they&rsquo;re free — in their own timezone — and the overlap draws itself.
            </p>
            <div className="hero__actions">
              <button
                type="button"
                className="button button--large"
                onClick={() => {
                  titleRef.current?.focus();
                  titleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
              >
                Create a room
              </button>
              <span className="hero__aside">Free, and no sign-up — for you or for them.</span>
            </div>
          </div>

          <DemoGrid />
        </header>

        <form
          className="card create-form"
          aria-labelledby="create-form-title"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="create-form__title" id="create-form-title">
            Set up your room
          </h2>

          <div className="field">
            <label className="field__label" htmlFor="room-title-input">
              What are you planning?
            </label>
            <input
              ref={titleRef}
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
            <div className="date-picker__header">
              <span className="field__label" id="date-picker-label">
                Which days?
              </span>
              <span className="month-nav">
                <button
                  type="button"
                  className="button button--ghost month-nav__step"
                  aria-label="Previous month"
                  disabled={monthOffset === 0}
                  onClick={() => {
                    setMonthOffset((offset) => Math.max(0, offset - 1));
                  }}
                >
                  <IconGlyph name="chevronLeft" />
                </button>
                <span className="month-nav__label" aria-live="polite">
                  {monthLabel}
                </span>
                <button
                  type="button"
                  className="button button--ghost month-nav__step"
                  aria-label="Next month"
                  disabled={monthOffset === 11}
                  onClick={() => {
                    setMonthOffset((offset) => Math.min(11, offset + 1));
                  }}
                >
                  <IconGlyph name="chevronRight" />
                </button>
              </span>
            </div>

            <div className="date-picker__grid" role="group" aria-labelledby="date-picker-label">
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
            <p className="field__hint" aria-live="polite">
              {dates.length === 0
                ? 'Pick at least one day to continue.'
                : `${String(dates.length)} day${dates.length === 1 ? '' : 's'} chosen.`}
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
            You&rsquo;re choosing these hours in <strong>{zone.replace(/_/g, ' ')}</strong>.
            Everyone else sees the same moments in their own timezone.
          </p>

          {error !== null && (
            <p className="error-text" role="alert">
              <span className="error-text__mark" aria-hidden="true">
                <IconGlyph name="alert" />
              </span>
              <span>{error}</span>
            </p>
          )}

          <div className="create-form__footer">
            <button
              type="submit"
              className="button button--large"
              disabled={!canSubmit}
              aria-busy={submitting}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? 'Creating your room' : 'Create the room'}
            </button>
          </div>
        </form>

        <section className="landing__how" aria-labelledby="how-title">
          <h2 className="landing__how-title" id="how-title">
            How it works
          </h2>
          <ol className="how-steps">
            {HOW_IT_WORKS.map((step, index) => (
              <li className="how-step" key={step.title}>
                <span className="how-step__number tabular" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="how-step__title">{step.title}</h3>
                <p className="how-step__body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
