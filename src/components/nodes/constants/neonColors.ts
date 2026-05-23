export const CATEGORY_NEON_COLORS: Record<string, string> = {
  backtest: "#a78bfa",
  scheduler: "#a78bfa",
  trigger: "#a78bfa",
  data: "#22d3ee",
  indicator: "#22d3ee",
  indicators: "#22d3ee",
  stream: "#22d3ee",
  input: "#22d3ee",
  logic: "#fb923c",
  switch: "#fb923c",
  if: "#fb923c",
  compute: "#fb923c",
  broker: "#34d399",
  portfolio: "#34d399",
  screener: "#34d399",
  ai: "#f472b6",
  llm: "#f472b6",
  chatmodel: "#f472b6",
  risk: "#f87171",
  destructive: "#f87171",
};

const CATEGORY_SURFACE_GRADIENTS: Record<string, string> = {
  ai: "radial-gradient(circle at 85% 0%, rgb(244 114 182 / 0.28), transparent 58%), linear-gradient(150deg, #24122f 0%, #1a1227 52%, #120d1c 100%)",
  llm: "radial-gradient(circle at 85% 0%, rgb(244 114 182 / 0.28), transparent 58%), linear-gradient(150deg, #24122f 0%, #1a1227 52%, #120d1c 100%)",
  chatmodel:
    "radial-gradient(circle at 85% 0%, rgb(244 114 182 / 0.28), transparent 58%), linear-gradient(150deg, #24122f 0%, #1a1227 52%, #120d1c 100%)",
  indicator:
    "radial-gradient(circle at 85% 0%, rgb(59 130 246 / 0.28), transparent 58%), linear-gradient(150deg, #111e3c 0%, #0e1931 52%, #0a1326 100%)",
  indicators:
    "radial-gradient(circle at 85% 0%, rgb(59 130 246 / 0.28), transparent 58%), linear-gradient(150deg, #111e3c 0%, #0e1931 52%, #0a1326 100%)",
  logic:
    "radial-gradient(circle at 85% 0%, rgb(251 146 60 / 0.3), transparent 58%), linear-gradient(150deg, #2f1e13 0%, #26190f 52%, #1c130c 100%)",
  switch:
    "radial-gradient(circle at 85% 0%, rgb(251 146 60 / 0.3), transparent 58%), linear-gradient(150deg, #2f1e13 0%, #26190f 52%, #1c130c 100%)",
  if: "radial-gradient(circle at 85% 0%, rgb(251 146 60 / 0.3), transparent 58%), linear-gradient(150deg, #2f1e13 0%, #26190f 52%, #1c130c 100%)",
  compute:
    "radial-gradient(circle at 85% 0%, rgb(251 146 60 / 0.3), transparent 58%), linear-gradient(150deg, #2f1e13 0%, #26190f 52%, #1c130c 100%)",
  data: "radial-gradient(circle at 85% 0%, rgb(34 211 238 / 0.28), transparent 58%), linear-gradient(150deg, #10252d 0%, #0e1f27 52%, #0b1820 100%)",
  stream:
    "radial-gradient(circle at 85% 0%, rgb(34 211 238 / 0.28), transparent 58%), linear-gradient(150deg, #10252d 0%, #0e1f27 52%, #0b1820 100%)",
  broker:
    "radial-gradient(circle at 85% 0%, rgb(52 211 153 / 0.28), transparent 58%), linear-gradient(150deg, #102820 0%, #0d211a 52%, #0a1913 100%)",
  portfolio:
    "radial-gradient(circle at 85% 0%, rgb(52 211 153 / 0.28), transparent 58%), linear-gradient(150deg, #102820 0%, #0d211a 52%, #0a1913 100%)",
  screener:
    "radial-gradient(circle at 85% 0%, rgb(52 211 153 / 0.28), transparent 58%), linear-gradient(150deg, #102820 0%, #0d211a 52%, #0a1913 100%)",
  risk: "radial-gradient(circle at 85% 0%, rgb(248 113 113 / 0.3), transparent 58%), linear-gradient(150deg, #2a1317 0%, #211015 52%, #180b10 100%)",
  destructive:
    "radial-gradient(circle at 85% 0%, rgb(248 113 113 / 0.3), transparent 58%), linear-gradient(150deg, #2a1317 0%, #211015 52%, #180b10 100%)",
};

const DEFAULT_NEON_COLOR = "#22d3ee";
const DEFAULT_SURFACE_GRADIENT =
  "radial-gradient(circle at 85% 0%, rgb(34 211 238 / 0.24), transparent 58%), linear-gradient(150deg, #122131 0%, #101b2a 52%, #0c1522 100%)";

export const resolveNodeNeonTheme = (
  categoryValue: unknown,
  fallbackColorToken?: string,
): { neonColor: string; surfaceGradient: string } => {
  const category = String(categoryValue ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const matchedKey = Object.keys(CATEGORY_NEON_COLORS).find((key) =>
    category.includes(key),
  );
  if (matchedKey) {
    return {
      neonColor: CATEGORY_NEON_COLORS[matchedKey],
      surfaceGradient:
        CATEGORY_SURFACE_GRADIENTS[matchedKey] ?? DEFAULT_SURFACE_GRADIENT,
    };
  }

  const fallbackColor =
    typeof fallbackColorToken === "string" && fallbackColorToken.length > 0
      ? fallbackColorToken
      : DEFAULT_NEON_COLOR;
  return { neonColor: fallbackColor, surfaceGradient: DEFAULT_SURFACE_GRADIENT };
};
