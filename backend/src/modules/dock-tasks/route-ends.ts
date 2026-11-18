import { RouteStop } from '../routes/schemas/route-stop.schema';

/** Stop 1 and stop 2 of a route, by `sequence`. A route in the dock flow has two stops. */
export function routeEnds<T extends Pick<RouteStop, 'sequence'>>(route: {
  id: string;
  stops: T[];
}): { origin: T; destination: T } {
  const stops = [...route.stops].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (stops.length !== 2) {
    throw new Error(`Route ${route.id} does not have two stops`);
  }
  return { origin: stops[0], destination: stops[1] };
}
