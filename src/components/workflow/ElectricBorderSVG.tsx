import React, { useId, useMemo } from "react";

interface ElectricBorderSVGProps {
  color?: string;
  className?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }

  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }

  return null;
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")}`;

const lightenHex = (hex: string, amount: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const { r, g, b } = rgb;
  const lightened = {
    r: Math.round(clamp(r + (255 - r) * amount, 0, 255)),
    g: Math.round(clamp(g + (255 - g) * amount, 0, 255)),
    b: Math.round(clamp(b + (255 - b) * amount, 0, 255)),
  };

  return rgbToHex(lightened.r, lightened.g, lightened.b);
};

const hexToRgba = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const ElectricBorderSVG: React.FC<ElectricBorderSVGProps> = ({
  color = "#dd8448",
  className = "",
}) => {
  const rawId = useId();
  const filterId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const cssVariables = useMemo(() => {
    const lightColor = lightenHex(color, 0.35);
    return {
      "--electric-border-color": color,
      "--electric-border-light": lightColor,
    } as React.CSSProperties;
  }, [color]);

  return (
    <div className={`electric-border-effect ${className}`} style={cssVariables}>
      <svg
        className="electric-border-effect__svg"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id={filterId}
            colorInterpolationFilters="sRGB"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise1"
              seed="1"
            />
            <feOffset in="noise1" dx="0" dy="0" result="offsetNoise1">
              <animate
                attributeName="dy"
                values="700; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise2"
              seed="1"
            />
            <feOffset in="noise2" dx="0" dy="0" result="offsetNoise2">
              <animate
                attributeName="dy"
                values="0; -700"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise3"
              seed="2"
            />
            <feOffset in="noise3" dx="0" dy="0" result="offsetNoise3">
              <animate
                attributeName="dx"
                values="490; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency="0.02"
              numOctaves="10"
              result="noise4"
              seed="2"
            />
            <feOffset in="noise4" dx="0" dy="0" result="offsetNoise4">
              <animate
                attributeName="dx"
                values="0; -490"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feComposite in="offsetNoise1" in2="offsetNoise2" result="part1" />
            <feComposite in="offsetNoise3" in2="offsetNoise4" result="part2" />
            <feBlend
              in="part1"
              in2="part2"
              mode="color-dodge"
              result="combinedNoise"
            />

            <feDisplacementMap
              in="SourceGraphic"
              in2="combinedNoise"
              scale="30"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>
      </svg>

      <div className="electric-border-effect__layers">
        <div className="electric-border-effect__glow" />
        <div
          className="electric-border-effect__border-main"
          style={{ filter: `url(#${filterId})` }}
        />
      </div>
    </div>
  );
};

export default ElectricBorderSVG;
