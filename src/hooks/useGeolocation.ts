import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../types';

interface GeolocationState {
  location: LatLng | null;
  heading: number | null;
  error: string | null;
  isTracking: boolean;
}

export function useGeolocation(): GeolocationState {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 위치 서비스를 지원하지 않습니다.');
      return;
    }

    const onSuccess = (pos: GeolocationPosition) => {
      setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      setHeading(pos.coords.heading);
      setError(null);
      setIsTracking(true);
    };

    const onError = (err: GeolocationPositionError) => {
      switch (err.code) {
        case err.PERMISSION_DENIED:
          setError('위치 권한이 거부되었습니다. 설정에서 허용해주세요.');
          break;
        case err.POSITION_UNAVAILABLE:
          setError('위치 정보를 사용할 수 없습니다.');
          break;
        case err.TIMEOUT:
          setError('위치 요청 시간이 초과되었습니다.');
          break;
        default:
          setError('위치를 가져오는 중 오류가 발생했습니다.');
      }
      setIsTracking(false);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { location, heading, error, isTracking };
}
