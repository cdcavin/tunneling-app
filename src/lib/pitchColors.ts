// Fixed color per pitch type, so a pitch keeps its color across pitchers and views.
// Hues come from a palette validated for color-vision deficiency on both the light
// panels and the dark 3D stage; pitch names are always shown next to the color.
const LIGHT: Record<string, string> = {
  "Four-Seam": "#e34948", Fastball: "#e34948", Sinker: "#eb6834", Cutter: "#e87ba4",
  Slider: "#2a78d6", Curveball: "#6250d6", Changeup: "#008300", Splitter: "#1baf7a", Sweeper: "#eda100",
};
const DARK: Record<string, string> = {
  "Four-Seam": "#e66767", Fastball: "#e66767", Sinker: "#d95926", Cutter: "#d55181",
  Slider: "#3987e5", Curveball: "#9085e9", Changeup: "#2f9e3a", Splitter: "#199e70", Sweeper: "#c98500",
};
export const pitchColor = (type: string) => LIGHT[type] ?? "#6b7a90";
export const pitchColorOnDark = (type: string) => DARK[type] ?? "#9aa7ba";

const ABBR: Record<string, string> = {
  "Four-Seam": "FF", Fastball: "FB", Sinker: "SI", Cutter: "FC", Slider: "SL",
  Curveball: "CU", Changeup: "CH", Splitter: "FS", Sweeper: "SW",
};
export const pitchAbbr = (type: string) => ABBR[type] ?? type.slice(0, 2).toUpperCase();
