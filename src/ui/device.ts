export function isMobileDevice(): boolean {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS se fait passer pour un Mac dans son user agent, mais reste tactile contrairement à un vrai Mac.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}
