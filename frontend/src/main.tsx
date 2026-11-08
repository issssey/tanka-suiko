import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// ピンチでの拡大縮小を止める。iPhone の Safari は viewport の user-scalable=no を無視するので、
// ジェスチャーのイベントを止める（ダブルタップの拡大は CSS の touch-action で止めている）
const stopPinch = (e: Event) => e.preventDefault();
document.addEventListener("gesturestart", stopPinch);
document.addEventListener("gesturechange", stopPinch);
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
