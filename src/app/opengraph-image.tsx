import { ImageResponse } from "next/og";

export const alt = "MyDeloadTracker, the AI strength coach that knows when to deload";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND = "rgb(44,186,119)";
const BG = "#0e1016";
const FG = "#eef2f6";
const MUTED = "#8a93a3";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: BRAND,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* simple dumbbell mark */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 8, height: 32, background: BG, borderRadius: 2 }} />
              <div style={{ width: 28, height: 12, background: BG }} />
              <div style={{ width: 8, height: 32, background: BG, borderRadius: 2 }} />
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: FG }}>
            MyDeloadTracker
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: FG, lineHeight: 1.05 }}>
            Know when to push,
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: "#f59e0b", lineHeight: 1.05 }}>
            and when to deload.
          </div>
          <div style={{ display: "flex", fontSize: 29, color: MUTED, marginTop: 22 }}>
            AI strength coach · readiness scoring · StrengthLevel standards · wearable recovery
          </div>
        </div>

        {/* Footer row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 28, color: BRAND, fontWeight: 600 }}>
            mydeloadtracker.vercel.app
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 24px",
              borderRadius: 999,
              background: "rgba(245,158,11,0.15)",
              color: "#f59e0b",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            Deload recommended · 3/3 signals
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
