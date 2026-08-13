import { useEffect, useState } from 'react';
import { roomIdFromLocation } from './lib/api.js';
import { Landing } from './components/Landing.js';
import { RoomView } from './components/RoomView.js';

/**
 * Routing, in full.
 *
 * There are exactly two views and one parameter, so a router would be more configuration than
 * code. The Worker serves `index.html` for any unmatched path, which is what makes a hard
 * refresh of `/r/:roomId` work.
 */
export function App(): React.JSX.Element {
  const [roomId, setRoomId] = useState<string | null>(() => roomIdFromLocation());

  useEffect(() => {
    const onPopState = (): void => {
      setRoomId(roomIdFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return roomId === null ? <Landing /> : <RoomView roomId={roomId} key={roomId} />;
}
