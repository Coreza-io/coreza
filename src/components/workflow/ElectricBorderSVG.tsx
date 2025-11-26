import React, { useId, useMemo } from "react";

interface ElectricBorderSVGProps {
  color?: string;
  className?: string;
  isExpanded?: boolean;
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
  isExpanded = true,
}) => {
  const rawId = useId();
  const filterId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  // Size-specific effect parameters
  const effectParams = useMemo(() => {
    if (isExpanded) {
      // Original values for expanded nodes
      return {
        baseFrequency: 0.02,
        numOctaves: 10,
        backgroundBlur: 28,
        glowBlurSoft: 8,
        glowBlurStrong: 3,
        scaleBackground: 1.12,
        scaleGlowSoft: 1.08,
        scaleGlowStrong: 1.03,
        scaleOverlay: 1.08,
        displacementScale: 30,
      };
    } else {
      // Enhanced values for collapsed nodes to maintain visual prominence
      return {
        baseFrequency: 0.075,
        numOctaves: 10,
        backgroundBlur: 35,
        glowBlurSoft: 12,
        glowBlurStrong: 6,
        scaleBackground: 1.17,
        scaleGlowSoft: 0,
        scaleGlowStrong: 1,
        scaleOverlay: 0,
        displacementScale: 10,
      };
    }
  }, [isExpanded]);

  const cssVariables = useMemo(() => {
    const lightColor = lightenHex(color, 0.35);
    return {
      "--electric-border-color": color,
      "--electric-border-light": lightColor,
      "--electric-border-outer": hexToRgba(color, 0.45),
      "--electric-border-glow": hexToRgba(lightColor, 0.7),
      "--electric-border-glow-soft": hexToRgba(lightColor, 0.35),
      "--electric-border-overlay": `linear-gradient(-30deg, rgba(255,255,255,0.9), transparent 32%, transparent 68%, rgba(255,255,255,0.85))`,
      "--electric-border-background": `linear-gradient(-30deg, ${lightColor}, transparent, ${color})`,
      "--electric-bg-blur": `${effectParams.backgroundBlur}px`,
      "--electric-glow-soft-blur": `${effectParams.glowBlurSoft}px`,
      "--electric-glow-strong-blur": `${effectParams.glowBlurStrong}px`,
      "--electric-scale-bg": effectParams.scaleBackground,
      "--electric-scale-glow-soft": effectParams.scaleGlowSoft,
      "--electric-scale-glow-strong": effectParams.scaleGlowStrong,
      "--electric-scale-overlay": effectParams.scaleOverlay,
    } as React.CSSProperties;
  }, [color, effectParams]);

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
              baseFrequency={effectParams.baseFrequency}
              numOctaves={effectParams.numOctaves}
              result="noise1"
              seed="1"
            />
            <feOffset in="noise1" dx="0" dy="0" result="offsetNoise1">
              <animate
                attributeName="dy"
                values="150; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency={effectParams.baseFrequency}
              numOctaves={effectParams.numOctaves}
              result="noise2"
              seed="1"
            />
            <feOffset in="noise2" dx="0" dy="0" result="offsetNoise2">
              <animate
                attributeName="dy"
                values="0; -150"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency={effectParams.baseFrequency}
              numOctaves={effectParams.numOctaves}
              result="noise3"
              seed="2"
            />
            <feOffset in="noise3" dx="0" dy="0" result="offsetNoise3">
              <animate
                attributeName="dx"
                values="150; 0"
                dur="6s"
                repeatCount="indefinite"
                calcMode="linear"
              />
            </feOffset>

            <feTurbulence
              type="turbulence"
              baseFrequency={effectParams.baseFrequency}
              numOctaves={effectParams.numOctaves}
              result="noise4"
              seed="2"
            />
            <feOffset in="noise4" dx="0" dy="0" result="offsetNoise4">
              <animate
                attributeName="dx"
                values="0; -150"
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
              scale={effectParams.displacementScale}
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </defs>
      </svg>

      <div className="electric-border-effect__layers">
        <div className="electric-border-effect__background" />
        <div className="electric-border-effect__glow electric-border-effect__glow--soft" />
        <div className="electric-border-effect__glow electric-border-effect__glow--strong" />
        <div className="electric-border-effect__border-outer" />
        <div
          className="electric-border-effect__border-main"
          style={{ filter: `url(#${filterId})` }}
        />
        <div className="electric-border-effect__overlay electric-border-effect__overlay--primary" />
        <div className="electric-border-effect__overlay electric-border-effect__overlay--secondary" />
      </div>
    </div>
  );
};

export default ElectricBorderSVG;
