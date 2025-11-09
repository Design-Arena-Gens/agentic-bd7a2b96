"use client";

import { useState } from "react";
import LiveAvatar from "../components/LiveAvatar";

export default function Page() {
  const [started, setStarted] = useState(false);
  return (
    <main>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1>Live Lipsync + Body Motion</h1>
        <span className="badge">Client-side ? No upload</span>
      </div>
      <p className="subtitle">Microphone-driven lipsync and real-time body motion from webcam using on-device inference.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="controls">
          <button className="btn" onClick={() => setStarted(true)} disabled={started}>Start camera + mic</button>
          <button className="btn ghost" onClick={() => setStarted(false)} disabled={!started}>Stop</button>
          <span className="hint">Grant permissions when prompted. Your media never leaves your device.</span>
        </div>
      </div>

      <LiveAvatar started={started} />

      <div className="sep" />
      <p className="hint">Tips: Speak near the mic to see stronger mouth movement. Step back to fit your full body in frame for better pose tracking.</p>
    </main>
  );
}
