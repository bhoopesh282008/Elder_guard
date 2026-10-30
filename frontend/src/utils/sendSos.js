import emergencyService from '../services/emergencyService';
import connectedPortalService from '../services/connectedPortalService';
import { getSosLocation } from './sosLocation';

// Sends an SOS to both alert systems using the device position (demo fallback if blocked).
// `delivered` is true only if at least one system accepted it, so callers never show a false "sent".
export async function sendSos(prefetchedLocation) {
  const location = prefetchedLocation || (await getSosLocation());
  const results = await Promise.allSettled([
    emergencyService.triggerSOS(location.lat, location.lng),
    connectedPortalService.triggerSOS({ lat: location.lat, lng: location.lng }),
  ]);
  results.forEach((result) => {
    if (result.status === 'rejected') console.warn('SOS channel failed:', result.reason);
  });
  return { delivered: results.some((result) => result.status === 'fulfilled'), location };
}
