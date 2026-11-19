// The API is the only authority for the accepted GPS accuracy limit.
// Browser-reported accuracy is an estimate, not proof that coordinates match reality.
export const GPS_WAIT_MS = 30_000;

export function watchAccurateLocation(geolocation, {
  requiredAccuracy,
  waitMs = GPS_WAIT_MS
} = {}) {
  let watchId = null;
  let timer = null;
  let settled = false;
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

    if (!Number.isFinite(requiredAccuracy) || requiredAccuracy <= 0) {
      finish(new Error('تعذر قراءة إعدادات دقة الموقع من الخادم'));
      return;
    }
    if (!geolocation?.watchPosition) {
      finish(new Error('الجهاز أو المتصفح لا يدعم تحديد الموقع'));
      return;
    }

    timer = setTimeout(() => {
      finish(new Error('تعذّر الحصول على موقع بدقة كافية. فعّل الموقع الدقيق، وجرّب من مكان مفتوح.'));
    }, waitMs);

    try {
      watchId = geolocation.watchPosition(position => {
        if (settled) return;
        const coords = position?.coords;
        const accuracy = coords?.accuracy;
        const age = Date.now() - position?.timestamp;
        if (!Number.isFinite(coords?.latitude) || Math.abs(coords.latitude) > 90 ||
            !Number.isFinite(coords?.longitude) || Math.abs(coords.longitude) > 180 ||
            !Number.isFinite(accuracy) || accuracy <= 0 ||
            !Number.isFinite(age) || age > 30_000 || age < -60_000) return;
        if (accuracy <= requiredAccuracy) finish(null, position);
      }, error => {
        if (settled) return;
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
