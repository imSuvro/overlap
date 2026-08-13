import { MAX_NAME_LENGTH } from '@overlap/protocol';
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from './Chrome.js';

export interface NameDialogProps {
  readonly title: string;
  readonly onSubmit: (name: string) => void;
}

/**
 * The only thing standing between opening a link and using the room.
 *
 * No account, no email, no password — a name, because the grid is meaningless if nobody can
 * tell whose row is whose. Deliberately the first and last piece of friction in the product.
 */
export function NameDialog({ title, onSubmit }: NameDialogProps): React.JSX.Element {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();

  return (
    <div className="overlay">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length > 0) onSubmit(trimmed);
        }}
      >
        <Wordmark />
        <h1 className="dialog__title" id="name-dialog-title">
          Join &ldquo;{title}&rdquo;
        </h1>
        <p className="dialog__body">
          Everyone in this room will see your name next to the times you pick. No account needed.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="participant-name">
            Your name
          </label>
          <input
            ref={inputRef}
            id="participant-name"
            className="input"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            placeholder="e.g. Priya"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>

        <button type="submit" className="button" disabled={trimmed.length === 0}>
          Start picking times
        </button>
      </form>
    </div>
  );
}
