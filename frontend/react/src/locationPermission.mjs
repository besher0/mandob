// Request geolocation permission upon entry to the representative app.
// Never store or submit these coordinates; visits still capture a new fix when completed.
export async function requestLocationPermission(geolocation, permissions) {
  if (typeof geolocation?.getCurrentPosition !== 'function') return 'unavailable';

  // Avoid activating the GPS chip on every launch once permission is settled.
  if (typeof permissions?.query === 'function') {
    try {
      const status = await permissions.query({name:'geolocation'});
      if (status?.state === 'granted' || status?.state === 'denied') return status.state;
    } catch {
      // Safari/other browsers may not implement Permissions.query for geolocation.
    }
  }

  // There is no standalone browser permission prompt API. Asking for one location fix
  // is the only fallback; deliberately discard it and never reuse it for visits.
  return new Promise(resolve => {
    try {
      geolocation.getCurrentPosition(
        () => resolve('granted'),
        error => resolve(error?.code === 1 ? 'denied' : 'unavailable'),
        {enableHighAccuracy:false,maximumAge:0,timeout:12000}
      );
    } catch {
      resolve('unavailable');
    }
  });
}
