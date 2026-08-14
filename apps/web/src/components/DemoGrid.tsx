const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const TIMES = ['9:00', '', '10:00', '', '11:00', '', '12:00', ''] as const;

/**
 * A worked example, not a screenshot.
 *
 * The landing page used to describe the product in prose and never show it, which meant the one
 * image that explains Overlap instantly — a block of time darkening where a group agrees — was
 * absent from the only screen a first-time visitor sees. This is that image, built from the same
 * tokens the real grid uses, so it cannot drift from the product it is advertising.
 *
 * Rows are half-hours from 9am; columns are weekdays. Each value is a step on the heat ramp,
 * hand-placed so Wednesday late morning is visibly the answer.
 */
const HEAT: readonly (readonly number[])[] = [
  [1, 0, 2, 1, 0],
  [2, 1, 3, 1, 0],
  [3, 2, 4, 2, 1],
  [3, 3, 5, 3, 1],
  [2, 3, 5, 4, 2],
  [1, 2, 4, 2, 2],
  [0, 1, 2, 1, 1],
  [0, 0, 1, 0, 0],
];

export function DemoGrid(): React.JSX.Element {
  return (
    <figure className="demo">
      <div className="demo__frame">
        <div className="demo__head" aria-hidden="true">
          <span className="demo__corner" />
          {DAYS.map((day) => (
            <span className="demo__day" key={day}>
              {day}
            </span>
          ))}
        </div>

        <div className="demo__body" aria-hidden="true">
          <div className="demo__times">
            {TIMES.map((time, row) => (
              <span className="demo__time tabular" key={row}>
                {time}
              </span>
            ))}
          </div>

          <div className="demo__cells">
            {HEAT.map((cells, row) =>
              cells.map((step, column) => (
                <span
                  key={`${String(row)}-${String(column)}`}
                  className={`demo__cell demo__cell--${step}${step === 5 ? ' demo__cell--peak' : ''}`}
                  /* Staggered on a diagonal so the reveal reads as one surface filling in.
                     Kept short — the last cell lands inside 700ms, because a hero that is still
                     assembling itself a second in is a hero nobody waited for. Neutralised
                     wholesale by the global reduced-motion block. */
                  style={{ animationDelay: `${String(40 + (row + column) * 22)}ms` }}
                />
              )),
            )}
          </div>
        </div>

        <span className="demo__cursor demo__cursor--one" aria-hidden="true">
          Priya
        </span>
        <span className="demo__cursor demo__cursor--two" aria-hidden="true">
          Marcus
        </span>
      </div>

      <figcaption className="demo__caption">
        Five people, one week. The darkest block is when everyone is free — Wednesday, 10:30.
      </figcaption>
    </figure>
  );
}
