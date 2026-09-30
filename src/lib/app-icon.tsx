import { ImageResponse } from "next/og";

// PWA / home-screen icon, rendered at build time so there are no binary assets to maintain.
// The glyphs sit well inside the central 80% so the same image works as a maskable icon.
export function appIcon(size: number) {
  const glyph = { width: size * 0.2, display: "flex", justifyContent: "center" } as const;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexWrap: "wrap",
          alignContent: "center",
          justifyContent: "center",
          background: "#2a78d6",
          color: "white",
          fontSize: size * 0.22,
          fontWeight: 700,
          lineHeight: 1,
          padding: size * 0.22,
        }}
      >
        <span style={glyph}>+</span>
        <span style={glyph}>-</span>
        <span style={glyph}>×</span>
        <span style={glyph}>÷</span>
      </div>
    ),
    { width: size, height: size },
  );
}
