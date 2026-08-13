import type { ConnectionStatus } from '@overlap/room-core';
import { useEffect, useState } from 'react';

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }): React.JSX.Element {
  return (
    <span className="wordmark" style={size === 'lg' ? { fontSize: 'var(--text-2xl)' } : undefined}>
      <svg className="wordmark__mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="4" y="4" width="15" height="15" rx="4" fill="var(--heat-2)" />
        <rect x="13" y="13" width="15" height="15" rx="4" fill="var(--accent)" opacity="0.85" />
      </svg>
      Overlap
    </span>
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
      <button
        type="button"
        className="button button--ghost"
        onClick={onDismiss}
        style={{ color: 'inherit' }}
      >
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
 */
export function ShareButton({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => {
      setCopied(false);
    }, 2_000);
    return () => {
      window.clearTimeout(handle);
    };
  }, [copied]);

  return (
    <>
      <button
        type="button"
        className="button"
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
            } catch {
              setFailed(true);
            }
          })();
        }}
      >
        {copied ? 'Link copied' : 'Share link'}
      </button>
      {failed && (
        <input
          className="input"
          readOnly
          value={url}
          aria-label="Room link — copy this"
          style={{ maxWidth: '18rem' }}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
      )}
    </>
  );
}
