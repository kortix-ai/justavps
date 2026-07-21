import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "justavps.com is becoming platinum.dev — the most affordable AI agent sandbox cloud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#09090b",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, color: "#a1a1aa", letterSpacing: 2 }}>
          JUSTAVPS.COM
        </div>
        <div style={{ fontSize: 68, fontWeight: 700, marginTop: 24, lineHeight: 1.1 }}>
          24/7 VPS sandbox for AI agents
        </div>
        <div style={{ fontSize: 34, color: "#a1a1aa", marginTop: 32, lineHeight: 1.4 }}>
          Becoming platinum.dev — the most affordable AI agent sandbox cloud
        </div>
      </div>
    ),
    size,
  );
}
