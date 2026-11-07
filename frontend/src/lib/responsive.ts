import { useEffect, useState } from "react";

/** PC版のレイアウトに切り替える幅（px）。 */
export const WIDE_QUERY = "(min-width: 1024px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}
