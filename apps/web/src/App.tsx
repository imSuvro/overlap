import { useEffect, useState } from 'react';
import { routeFromLocation, type Route } from './lib/api.js';
import { Landing } from './components/Landing.js';
import { BrokenLink } from './components/BrokenLink.js';
import { RoomView } from './components/RoomView.js';

/**
 * Routing, in full.
 *
 * There are exactly two views and one parameter, so a router would be more configuration than
 * code. The Worker serves `index.html` for any unmatched path, which is what makes a hard
 * refresh of `/r/:roomId` work.
 *
 * The third case is not a view so much as an answer: a room id that fails validation is a link
 * that got cut short somewhere, and saying so is the difference between the user re-copying it
 * and the user quietly starting a second room.
 */
export function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => routeFromLocation());

  useEffect(() => {
    const onPopState = (): void => {
      setRoute(routeFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  switch (route.kind) {
    case 'room':
      return <RoomView roomId={route.roomId} key={route.roomId} />;
    case 'brokenLink':
      return <BrokenLink />;
    case 'landing':
      return <Landing />;
  }
}
