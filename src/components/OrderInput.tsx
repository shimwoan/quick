import { useState } from 'react';
import { useOrderStore } from '../stores/useOrderStore';
import type { Order, LatLng } from '../types';

declare global {
  interface Window {
    daum: any;
  }
}

let daumScriptLoaded = false;

function loadDaumPostcodeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (daumScriptLoaded && window.daum?.Postcode) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = () => {
      daumScriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('다음 주소 스크립트 로드 실패'));
    document.head.appendChild(script);
  });
}

function searchAddress(): Promise<{ address: string; jibunAddress: string } | null> {
  return new Promise((resolve) => {
    if (!window.daum?.Postcode) {
      resolve(null);
      return;
    }
    new window.daum.Postcode({
      oncomplete: (data: any) => {
        const address = data.roadAddress || data.jibunAddress;
        const jibunAddress = data.jibunAddress || data.autoJibunAddress;
        resolve({ address, jibunAddress });
      },
      onclose: () => {
        // 사용자가 닫으면 null
      },
    }).open();
  });
}

async function geocodeWithNaver(address: string): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!window.naver?.maps?.Service) {
      resolve(null);
      return;
    }
    window.naver.maps.Service.geocode(
      { query: address },
      (status: number, response: any) => {
        if (status !== 200 || !response?.v2?.addresses?.length) {
          resolve(null);
          return;
        }
        const item = response.v2.addresses[0];
        resolve({ lat: parseFloat(item.y), lng: parseFloat(item.x) });
      }
    );
  });
}

const STATUS_LABELS: Record<Order['status'], string> = {
  pending: '대기',
  picked_up: '픽업완료',
  in_transit: '이동중',
  completed: '배달완료',
  cancelled: '취소',
};

const STATUS_COLORS: Record<Order['status'], string> = {
  pending: '#f59e0b',
  picked_up: '#3b82f6',
  in_transit: '#7c3aed',
  completed: '#22c55e',
  cancelled: '#ef4444',
};

export default function OrderInput() {
  const { orders, addOrder, removeOrder } = useOrderStore();
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [pickupLocation, setPickupLocation] = useState<LatLng | null>(null);
  const [dropoffLocation, setDropoffLocation] = useState<LatLng | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearchAddress = async (type: 'pickup' | 'dropoff') => {
    try {
      await loadDaumPostcodeScript();
      const result = await searchAddress();
      if (!result) return;

      // 네이버 지오코딩으로 좌표 변환
      const location = await geocodeWithNaver(result.address)
        || await geocodeWithNaver(result.jibunAddress);

      if (type === 'pickup') {
        setPickupAddress(result.address);
        setPickupLocation(location);
        if (!location) setError('픽업 주소의 좌표를 찾을 수 없습니다.');
        else setError('');
      } else {
        setDropoffAddress(result.address);
        setDropoffLocation(location);
        if (!location) setError('배달 주소의 좌표를 찾을 수 없습니다.');
        else setError('');
      }
    } catch {
      setError('주소 검색 중 오류가 발생했습니다.');
    }
  };

  const handleAdd = () => {
    if (!pickupAddress || !dropoffAddress || !pickupLocation || !dropoffLocation) {
      setError('픽업과 배달 주소를 모두 검색해주세요.');
      return;
    }

    setIsLoading(true);
    setError('');

    const order: Order = {
      id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pickup_address: pickupAddress,
      pickup_location: pickupLocation,
      dropoff_address: dropoffAddress,
      dropoff_location: dropoffLocation,
      status: 'pending',
    };

    addOrder(order);
    setPickupAddress('');
    setDropoffAddress('');
    setPickupLocation(null);
    setDropoffLocation(null);
    setIsLoading(false);
  };

  return (
    <div className="order-input">
      <h3 className="section-title">오더 입력</h3>

      <div className="input-group">
        <div className="address-row">
          <input
            type="text"
            placeholder="픽업 주소를 검색하세요"
            value={pickupAddress}
            readOnly
            className="input-field"
            onClick={() => handleSearchAddress('pickup')}
          />
          <button
            type="button"
            className="btn btn-search"
            onClick={() => handleSearchAddress('pickup')}
          >
            검색
          </button>
        </div>
        <div className="address-row">
          <input
            type="text"
            placeholder="배달 주소를 검색하세요"
            value={dropoffAddress}
            readOnly
            className="input-field"
            onClick={() => handleSearchAddress('dropoff')}
          />
          <button
            type="button"
            className="btn btn-search"
            onClick={() => handleSearchAddress('dropoff')}
          >
            검색
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleAdd}
        disabled={!pickupLocation || !dropoffLocation || isLoading}
      >
        추가
      </button>

      {orders.length > 0 && (
        <div className="order-list">
          {orders.map((order) => (
            <div key={order.id} className="order-card">
              <div className="order-info">
                <div className="order-addresses">
                  <span className="order-pickup">{order.pickup_address}</span>
                  <span className="order-arrow">&rarr;</span>
                  <span className="order-dropoff">{order.dropoff_address}</span>
                </div>
                <span
                  className="order-status-badge"
                  style={{ background: STATUS_COLORS[order.status] }}
                >
                  {STATUS_LABELS[order.status]}
                </span>
              </div>
              <button
                type="button"
                className="btn-delete"
                onClick={() => removeOrder(order.id)}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
