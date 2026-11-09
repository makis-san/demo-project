/**
 * A short name for a browser, such as "Chrome on macOS", for the list of signed-in devices. It is a guess made from the
 * user agent, which the browser chooses, so it only helps the user recognise their own device. It decides nothing.
 * The order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
 */
export function deviceLabel(userAgent: string | undefined | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;

  // iPhone and iPad user agents also say "Mac OS X", and Android ones say "Linux", so those come first.
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
