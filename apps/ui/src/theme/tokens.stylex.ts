import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  background: "#f7f1e7",
  surface: "#fbf5ec",
  surfaceAlt: "#f2e7d9",
  surfaceStrong: "#eadcc9",
  border: "#d8c7b2",
  text: "#2b2118",
  textMuted: "#6f5a46",
  textSubtle: "#8b725c",
  accent: "#2f4b3a",
  accentHover: "#3b5b46",
  focusRing: "rgba(47, 75, 58, 0.35)",
  successText: "#2f5d3d",
  successBg: "#e3efe6",
  warnText: "#8a5a2b",
  warnBg: "#f7ead8",
  errorText: "#8d3f37",
  errorBg: "#f6e2de",
  infoText: "#2f4e68",
  infoBg: "#e3ebf2",
  neutralText: "#5f4a39",
  neutralBg: "#f1e7da",
});

export const spacing = stylex.defineVars({
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
});

export const radius = stylex.defineVars({
  sm: "4px",
  md: "8px",
  lg: "8px",
});

export const typography = {
  xs: { fontSize: "12px", lineHeight: "1.4" },
  sm: { fontSize: "14px", lineHeight: "1.5" },
  md: { fontSize: "16px", lineHeight: "1.6" },
  lg: { fontSize: "20px", lineHeight: "1.4" },
  xl: { fontSize: "24px", lineHeight: "1.3" },
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
};
