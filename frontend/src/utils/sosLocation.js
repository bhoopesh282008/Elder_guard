// Demo coordinates, used only when the browser cannot supply a position.
export const FALLBACK_SOS_LOCATION = { lat: 37.7749, lng: -122.4194 };

// Resolves with the device position, or the fallback if location is blocked, unavailable or slow.
export function getSosLocation(timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(FALLBACK_SOS_LOCATION);
      return;
    }
    const guard = setTimeout(() => resolve(FALLBACK_SOS_LOCATION), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(guard);
        resolve(FALLBACK_SOS_LOCATION);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
