import { StatusScreen } from './Chrome.js';

/**
 * A `/r/…` URL whose room id could not possibly be real.
 *
 * Distinct from "this room is gone": nothing was looked up, because the id fails validation
 * before any request is worth making. The copy says what actually happened to them — links get
 * cut short when they are copied out of a chat — rather than describing our validation rule.
 */
export function BrokenLink(): React.JSX.Element {
  return (
    <StatusScreen
      tone="alert"
      title="This link is incomplete"
      body={
        <>
          Room links end in a 22-character code, and this one doesn&rsquo;t — it was most likely
          cut short when it was copied. Ask whoever sent it to share it again, or start your own
          room in about ten seconds.
        </>
      }
      actions={
        <a className="button" href="/">
          Start a new room
        </a>
      }
    />
  );
}
