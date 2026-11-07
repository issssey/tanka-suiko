// 端末ごとの設定（表示条件・新しい短歌の既定）。localStorage に置く。
import { useCallback, useState } from "react";
import { DEFAULT_DISPLAY, type DisplayOptions } from "./findings";

export interface Settings extends DisplayOptions {
  defaultStyle: "auto" | "colloquial" | "literary";
  defaultOrthography: "auto" | "modern" | "historical";
}

const KEY = "suiko.settings.v1";
const DEFAULTS: Settings = { ...DEFAULT_DISPLAY, defaultStyle: "auto", defaultOrthography: "auto" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 保存できなくても画面上は反映する */
      }
      return next;
    });
  }, []);
  return [settings, update];
}
