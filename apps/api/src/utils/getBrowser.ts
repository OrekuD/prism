export function getBrowser(userAgent: string) {
  if (/Firefox/i.test(userAgent)) return "Firefox";
  if (/Chrome/i.test(userAgent)) return "Chrome";
  if (/Safari/i.test(userAgent)) return "Safari";
  if (/Opera|OPR/i.test(userAgent)) return "Opera";
  if (/Edge/i.test(userAgent)) return "Edge";
  if (/MSIE|Trident/i.test(userAgent)) return "Internet Explorer";
  return "unknown";
}
