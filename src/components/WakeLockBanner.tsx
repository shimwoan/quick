import { useWakeLock } from '../hooks/useWakeLock';

export default function WakeLockBanner() {
  const { isSupported, isActive, request } = useWakeLock();

  if (isSupported && isActive) return null;

  const message = !isSupported
    ? '화면 꺼짐 방지가 지원되지 않는 브라우저입니다. 이동 중 화면을 켜두세요.'
    : '화면 꺼짐 방지가 해제되었습니다. 탭하여 다시 활성화하세요.';

  return (
    <div
      className="wakelock-banner"
      onClick={() => isSupported && request()}
      role={isSupported ? 'button' : undefined}
      tabIndex={isSupported ? 0 : undefined}
      onKeyDown={(e) => e.key === 'Enter' && isSupported && request()}
    >
      <span className="wakelock-icon">&#x26a0;</span>
      <span>{message}</span>
    </div>
  );
}
