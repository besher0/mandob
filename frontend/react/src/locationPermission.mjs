// Confirm that a representative has both browser permission and a functioning
// location provider before allowing entry to the application. Never retain the
// coordinates from this check; a visit must always capture a fresh fix.
export async function requestLocationPermission(geolocation) {
  if (typeof geolocation?.getCurrentPosition !== 'function') return 'unavailable';

  // Permissions.query alone is insufficient: it may report 'granted' even when
  // the device location service is off or cannot supply a fresh fix.
  return new Promise(resolve => {
    try {
      geolocation.getCurrentPosition(
        position => {
          const latitude = position?.coords?.latitude;
          const longitude = position?.coords?.longitude;
          resolve(Number.isFinite(latitude) && Number.isFinite(longitude) &&
            Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? 'granted' : 'unavailable');
        },
        error => resolve(error?.code === 1 ? 'denied' : 'unavailable'),
        {enableHighAccuracy:true, maximumAge:0, timeout:15000}
      );
    } catch {
      resolve('unavailable');
    }
  });
}
