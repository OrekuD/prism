export function getOS(userAgent: string) {
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iOS|iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  return "unknown";
}
