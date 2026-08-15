import { useEffect, useState } from 'react';
import { IconGlyph, Wordmark } from './Chrome.js';

export interface RoomCreatedProps {
  readonly title: string;
  readonly shareUrl: string;
  readonly onContinue: () => void;
}

/**
 * The moment between making a room and using it.
 *
 * Creating a room used to navigate straight into it, where the very next thing was a modal
 * asking for a name — so the host never once saw the link, which is the entire reason they made
 * a room. Sharing is the only action this screen has; entering the room is the way out of it.
 *
 * The link is shown in full and selectable, not hidden behind a button. Clipboard access is
 * denied outright on insecure origins and in some browser configurations, and "the copy button
 * did nothing" is a dead end at the one step the whole product depends on.
 */
export function RoomCreated({ title, shareUrl, onContinue }: RoomCreatedProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => {
      setCopied(false);
    }, 2_400);
    return () => {
      window.clearTimeout(handle);
    };
  }, [copied]);

  return (
    <div className="created">
      <div className="created__inner">
        <Wordmark size="lg" />

        <div>
          <p className="created__eyebrow">Your room is ready</p>
          <h1 className="created__title">{title}</h1>
        </div>

        <p className="created__lede">
          Send this link to everyone you&rsquo;re planning with. They can open it and start marking
          times straight away — no account, no install.
        </p>

        <div className="created__link">
          <label className="visually-hidden" htmlFor="created-share-url">
            Link to this room
          </label>
          <input
            id="created-share-url"
            className="input created__url"
            readOnly
            value={shareUrl}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className={`button${copied ? ' button--secondary' : ''}`}
            onClick={() => {
              void (async () => {
                try {
                  if ('share' in navigator && /Android|iPhone|iPad/.test(navigator.userAgent)) {
                    await navigator.share({ title: 'Overlap', url: shareUrl });
                    return;
                  }
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setFailed(false);
                } catch {
                  setFailed(true);
                }
              })();
            }}
          >
            <IconGlyph name={copied ? 'check' : 'link'} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {failed && (
          <p className="field__hint" role="status">
            Your browser wouldn&rsquo;t let us reach the clipboard. Select the link above and copy
            it yourself — it works exactly the same.
          </p>
        )}

        {/*
          Emphasis follows what the host has actually done. Before they have the link, copying is
          the primary action and continuing is the quiet one; once it is copied, the only thing
          left to do is go and mark your own availability.
        */}
        <button
          type="button"
          className={`button button--large${copied ? '' : ' button--secondary'}`}
          onClick={onContinue}
        >
          Continue to the room
        </button>

        <p className="created__aside">
          You can get this link again any time from <strong>Share link</strong> in the room.
        </p>
      </div>
    </div>
  );
}
