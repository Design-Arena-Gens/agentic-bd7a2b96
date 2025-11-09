"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Pose } from "@mediapipe/pose";
import { Camera } from "@mediapipe/camera_utils";

type Props = { started: boolean };

const CDN = (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;

function computeRms(analyser: AnalyserNode, buffer: Float32Array): number {
  analyser.getFloatTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / buffer.length);
  // Smoothstep-ish scaling for nicer visual mouth response
  const scaled = Math.max(0, Math.min(1, (rms - 0.01) * 12));
  return scaled;
}

const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];

export default function LiveAvatar({ started }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const poseRef = useRef<Pose | null>(null);
  const landmarksRef = useRef<any[] | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioBufferRef = useRef<Float32Array | null>(null);

  const rafRef = useRef<number | null>(null);

  const canvasSize = useMemo(() => ({ width: 1280, height: 720 }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
  }, [canvasSize]);

  useEffect(() => {
    if (!started) {
      // Stop
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      cameraRef.current?.stop();
      cameraRef.current = null;
      poseRef.current?.close();
      poseRef.current = null;

      const v = videoRef.current;
      if (v && v.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }

      analyserRef.current?.disconnect();
      analyserRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      audioBufferRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Get camera + mic
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        if (cancelled) return;

        // Attach to hidden video element
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Audio setup
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ac;
        const source = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyserRef.current = analyser;
        audioBufferRef.current = new Float32Array(analyser.fftSize);

        // Pose setup
        const pose = new Pose({ locateFile: (file: string) => CDN(file) });
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        pose.onResults((results) => {
          landmarksRef.current = results.poseLandmarks ?? null;
        });
        poseRef.current = pose;

        // Camera pump
        if (videoRef.current) {
          const cam = new Camera(videoRef.current, {
            onFrame: async () => {
              if (!poseRef.current || !videoRef.current) return;
              await poseRef.current.send({ image: videoRef.current });
            },
            width: canvasSize.width,
            height: canvasSize.height,
          });
          cameraRef.current = cam;
          cam.start();
        }

        // Render loop
        const render = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          // Background
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Draw body skeleton if available
          const lm = landmarksRef.current;
          if (lm && lm.length) {
            ctx.lineWidth = 6;
            ctx.strokeStyle = "#38bdf8";
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            for (const [a, b] of SKELETON_CONNECTIONS) {
              const p1 = lm[a];
              const p2 = lm[b];
              if (!p1 || !p2) continue;
              ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
              ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Estimate head position from shoulders
            const ls = lm[LM.LEFT_SHOULDER];
            const rs = lm[LM.RIGHT_SHOULDER];
            if (ls && rs) {
              const cx = ((ls.x + rs.x) / 2) * canvas.width;
              const cy = ((ls.y + rs.y) / 2) * canvas.height - 80; // lift head above shoulders
              const shoulderDist = Math.hypot((ls.x - rs.x) * canvas.width, (ls.y - rs.y) * canvas.height);
              const headRadius = Math.max(24, Math.min(80, shoulderDist * 0.35));

              // Head
              ctx.fillStyle = "#e5e7eb";
              ctx.beginPath();
              ctx.arc(cx, cy, headRadius, 0, Math.PI * 2);
              ctx.fill();

              // Eyes
              ctx.fillStyle = "#111827";
              const eyeOffsetX = headRadius * 0.35;
              const eyeOffsetY = headRadius * -0.1;
              const eyeR = Math.max(3, headRadius * 0.08);
              ctx.beginPath();
              ctx.arc(cx - eyeOffsetX, cy + eyeOffsetY, eyeR, 0, Math.PI * 2);
              ctx.arc(cx + eyeOffsetX, cy + eyeOffsetY, eyeR, 0, Math.PI * 2);
              ctx.fill();

              // Mouth (lipsync from audio RMS)
              const analyser = analyserRef.current;
              const buf = audioBufferRef.current;
              let mouthOpen = 0.15; // idle
              if (analyser && buf) {
                mouthOpen = computeRms(analyser, buf);
              }
              const mouthWidth = headRadius * 0.9;
              const mouthHeight = Math.max(headRadius * 0.08, headRadius * mouthOpen * 0.6);
              ctx.fillStyle = "#ef4444";
              ctx.beginPath();
              ctx.roundRect(cx - mouthWidth / 2, cy + headRadius * 0.35, mouthWidth, mouthHeight, 8);
              ctx.fill();
            }
          } else {
            // Idle face centered if no pose yet
            const cx = canvas.width / 2;
            const cy = canvas.height / 2 - 60;
            const headRadius = 60;
            ctx.fillStyle = "#e5e7eb";
            ctx.beginPath();
            ctx.arc(cx, cy, headRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#111827";
            ctx.beginPath();
            ctx.arc(cx - 20, cy - 6, 6, 0, Math.PI * 2);
            ctx.arc(cx + 20, cy - 6, 6, 0, Math.PI * 2);
            ctx.fill();
            const analyser = analyserRef.current;
            const buf = audioBufferRef.current;
            let mouthOpen = 0.12;
            if (analyser && buf) mouthOpen = computeRms(analyser, buf);
            const mouthWidth = 52;
            const mouthHeight = Math.max(6, mouthOpen * 30);
            ctx.fillStyle = "#ef4444";
            ctx.beginPath();
            ctx.roundRect(cx - mouthWidth / 2, cy + 26, mouthWidth, mouthHeight, 6);
            ctx.fill();
          }

          // Video preview (bottom-right)
          const video = videoRef.current;
          if (video && video.readyState >= 2) {
            const previewW = 200;
            const previewH = Math.round(previewW * (9 / 16));
            ctx.save();
            ctx.globalAlpha = 0.7;
            ctx.drawImage(video, canvas.width - previewW - 14, canvas.height - previewH - 14, previewW, previewH);
            ctx.restore();
          }

          rafRef.current = requestAnimationFrame(render);
        };
        render();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [started, canvasSize]);

  return (
    <div className="card">
      <div className="canvasWrap">
        <canvas ref={canvasRef} />
        <div className="videoPreview" aria-hidden>
          <video ref={videoRef} playsInline muted style={{ display: "block" }} />
        </div>
      </div>
    </div>
  );
}
