// Wait for a fresh GPS fix that meets the same accuracy limit configured in backend/.env.
// Keep this number aligned with MAX_GPS_ACCURACY_METERS on the deployed API.
export const GPS_REQUIRED_ACCURACY_METERS = 50;
export const GPS_WAIT_MS = 30_000;

export function watchAccurateLocation(geolocation, {
  requiredAccuracy = GPS_REQUIRED_ACCURACY_METERS,
  waitMs = GPS_WAIT_MS,
  onAccuracy = () => {}
} = {}) {
  let watchId = null;
  let timer = null;
  let settled = false;
  let bestAccuracy = null;
  let finish;

  const promise = new Promise((resolve, reject) => {
    finish = (error, position) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (watchId !== null) geolocation?.clearWatch(watchId);
      if (error) reject(error);
      else resolve(position);
    };

    if (!geolocation?.watchPosition) {
      finish(new Error('الجهاز أو المتصفح لا يدعم تحديد الموقع'));
      return;
    }

    timer = setTimeout(() => {
      const best = bestAccuracy === null ? '' :
        ` أفضل دقة وصلنا إليها ±${Math.ceil(bestAccuracy)} متر.`;
      finish(new Error(
        `لم نصل إلى دقة ${requiredAccuracy} متر خلال ${Math.ceil(waitMs / 1000)} ثانية.` +
        best + ' فعّل الموقع الدقيق، وانتقل لمكان مفتوح ثم أعد المحاولة.'
      ));
    }, waitMs);

    try {
      watchId = geolocation.watchPosition(position => {
        const coords = position?.coords;
        const accuracy = coords?.accuracy;
        const age = Date.now() - position?.timestamp;
        if (!Number.isFinite(coords?.latitude) || Math.abs(coords.latitude) > 90 ||
            !Number.isFinite(coords?.longitude) || Math.abs(coords.longitude) > 180 ||
            !Number.isFinite(accuracy) || accuracy <= 0 ||
            !Number.isFinite(age) || age > 30_000 || age < -60_000) return;
        bestAccuracy = bestAccuracy === null ? accuracy : Math.min(bestAccuracy, accuracy);
        onAccuracy(bestAccuracy);
        if (accuracy <= requiredAccuracy) finish(null, position);
      }, error => {
        // Transient GPS timeouts/unavailable fixes are retried within the overall wait.
        if (error?.code === 1) finish(error);
        else if (error?.code !== 2 && error?.code !== 3)
          finish(new Error(error?.message || 'تعذّر الوصول للموقع'));
      }, {enableHighAccuracy: true, timeout: 20_000, maximumAge: 0});

      // Be safe even if a test/browser calls success synchronously.
      if (settled && watchId !== null) geolocation.clearWatch(watchId);
    } catch (error) {
      finish(error);
    }
  });

  return {
    promise,
    cancel: () => finish?.(new Error('تم إيقاف تحديد الموقع'))
  };
}
