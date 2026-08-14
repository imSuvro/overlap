import type { ConnectionStatus } from '@overlap/room-core';
import { useEffect, useState } from 'react';

/**
 * The icon set, drawn rather than typed.
 *
 * Glyph arrows and emoji were the previous approach and both carry a different baseline, weight
 * and advance width in every font a device might fall back through, so a button label would
 * shift depending on which one won. These inherit `currentColor` and one size.
 */
function Icon({ path, label }: { path: string; label?: string }): React.JSX.Element {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      <path d={path} />
    </svg>
  );
}

const PATHS = {
  chevronLeft: 'M12.5 4.5 7 10l5.5 5.5',
  chevronRight: 'M7.5 4.5 13 10l-5.5 5.5',
  check: 'M4 10.5 8 14.5 16 5.5',
  link: 'M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1',
  alert:
    'M10 6.5v4.5M10 14h.01M8.6 3.2 2.3 14a1.6 1.6 0 0 0 1.4 2.4h12.6a1.6 1.6 0 0 0 1.4-2.4L11.4 3.2a1.6 1.6 0 0 0-2.8 0Z',
  pin: 'M7 3h6M10 3v6M5.5 9h9l1 3.5h-11ZM10 12.5V17',
} as const;

export function IconGlyph({ name, label }: { name: keyof typeof PATHS; label?: string }) {
  return <Icon path={PATHS[name]} label={label} />;
}

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }): React.JSX.Element {
  return (
    <span className={`wordmark${size === 'lg' ? ' wordmark--lg' : ''}`}>
      <svg className="wordmark__mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="4" y="4" width="15" height="15" rx="4" fill="var(--heat-2)" />
        <rect x="13" y="13" width="15" height="15" rx="4" fill="var(--accent)" opacity="0.85" />
      </svg>
      Overlap
    </span>
  );
}

/**
 * The shared shape of every screen that is not the app: loading, gone, unreachable, mistyped.
 *
 * They were four ad-hoc blocks of centred text with inline styles. Giving them one component
 * means the error states are as considered as the working ones, which is the whole difference
 * between a product and a demo.
 */
export function StatusScreen({
  title,
  body,
  actions,
  tone = 'neutral',
}: {
  title: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
  tone?: 'neutral' | 'alert';
}): React.JSX.Element {
  return (
    <div className="status-screen">
      <div className="status-screen__inner">
        <Wordmark size="lg" />
        {tone === 'alert' && (
          <span className="status-screen__mark" aria-hidden="true">
            <IconGlyph name="alert" />
          </span>
        )}
        <h1 className="status-screen__title">{title}</h1>
        <p className="status-screen__body">{body}</p>
        {actions !== undefined && <div className="status-screen__actions">{actions}</div>}
      </div>
    </div>
  );
}

const STATUS_COPY: Record<ConnectionStatus, string> = {
  live: 'Live',
  connecting: 'Reconnecting',
  offline: 'Offline',
};

/**
 * Connection state, phrased for someone who does not think about sockets.
 *
 * "Offline — your changes are saved" is the important one: the CRDT genuinely means nothing is
 * lost, and saying so is the difference between a user trusting the app and re-entering
 * everything after a tunnel.
 */
export function ConnectionBadge({
  status,
  pendingCount,
}: {
  status: ConnectionStatus;
  pendingCount: number;
}): React.JSX.Element {
  const detail =
    status === 'offline' && pendingCount > 0
      ? `Offline — ${String(pendingCount)} change${pendingCount === 1 ? '' : 's'} saved here`
      : status === 'offline'
        ? 'Offline — changes are saved here'
        : STATUS_COPY[status];

  return (
    <span className={`status status--${status}`} role="status">
      <span className="status__dot" />
      {detail}
    </span>
  );
}

/**
 * The offline explanation, given room to speak.
 *
 * The badge alone is a small pill in a header, and the one moment the app most needs to be
 * believed is the one moment it was whispering. This appears in the flow of the page, says
 * plainly that nothing is lost, and disappears the instant the socket is back.
 */
export function OfflineNotice({
  status,
  pendingCount,
  everConnected,
}: {
  status: ConnectionStatus;
  pendingCount: number;
  everConnected: boolean;
}): React.JSX.Element | null {
  /*
   * Two conditions, and both exist to stop this block moving the grid underneath a drag.
   *
   * `everConnected` because status starts at `offline` — true, but not yet worth saying — so
   * without it every room load rendered this banner and then removed it a few hundred
   * milliseconds later, shifting the whole page on load.
   *
   * `!== 'live'` rather than `=== 'offline'` because a disconnected client flips to
   * `connecting` on each retry. Keyed on `offline` alone the banner blinked out and back on
   * every backoff tick, and a drag in progress landed on rows two positions from where it
   * started.
   */
  if (!everConnected || status === 'live') return null;

  return (
    <div className="offline-notice" role="status">
      <span className="offline-notice__mark" aria-hidden="true">
        <IconGlyph name="alert" />
      </span>
      <div>
        <strong className="offline-notice__title">You&rsquo;re offline — keep painting</strong>
        <p className="offline-notice__body">
          {pendingCount > 0
            ? `${String(pendingCount)} change${pendingCount === 1 ? '' : 's'} ${pendingCount === 1 ? 'is' : 'are'} saved on this device and will reach everyone else the moment you reconnect.`
            : 'Everything you mark is saved on this device and will reach everyone else the moment you reconnect.'}
        </p>
      </div>
    </div>
  );
}

export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, 5_000);
    return () => {
      window.clearTimeout(handle);
    };
  }, [message, onDismiss]);

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="button button--ghost toast__dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * Copies the room link.
 *
 * The clipboard API is unavailable on insecure origins and can be denied outright, so a
 * failure falls back to selecting the URL rather than leaving the button silently doing
 * nothing — sharing the link is the one action the whole product depends on.
 *
 * The label is "Share link" in every place this appears. An action that renames itself between
 * the header and the empty state reads as two different actions.
 */
export function ShareButton({
  url,
  variant = 'primary',
}: {
  url: string;
  /** `secondary` when something else on the screen is the primary action — see DESIGN.md §4. */
  variant?: 'primary' | 'secondary' | 'large';
}): React.JSX.Element {
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
    <>
      <button
        type="button"
        className={`button${variant === 'large' ? ' button--large' : ''}${variant === 'secondary' ? ' button--secondary' : ''}`}
        onClick={() => {
          void (async () => {
            try {
              // `in` rather than a truthiness check: the DOM lib types `share` as always
              // present, but it genuinely is not on desktop browsers.
              if ('share' in navigator && /Android|iPhone|iPad/.test(navigator.userAgent)) {
                await navigator.share({ title: 'Overlap', url });
                return;
              }
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          })();
        }}
      >
        <IconGlyph name={copied ? 'check' : 'link'} />
        {copied ? 'Copied' : 'Share link'}
      </button>
      {failed && (
        <label className="share-fallback">
          <span className="field__label">Copy this link and send it to your group</span>
          <input
            className="input share-fallback__input"
            readOnly
            value={url}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </label>
      )}
    </>
  );
}
