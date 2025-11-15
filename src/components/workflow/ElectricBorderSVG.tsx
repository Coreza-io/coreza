import React from 'react';

interface ElectricBorderSVGProps {
  color?: string;
  className?: string;
}

const ElectricBorderSVG: React.FC<ElectricBorderSVGProps> = ({ 
  color = '#00ffff',
  className = ''
}) => {
  return (
    <svg 
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ zIndex: 2 }}
    >
      <defs>
        <filter id="electric-glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        
        <filter id="electric-turbulence">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency="0.02" 
            numOctaves="3"
            result="turbulence"
          >
            <animate
              attributeName="baseFrequency"
              dur="3s"
              values="0.02;0.03;0.02"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap 
            in="SourceGraphic" 
            in2="turbulence" 
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      
      <rect
        x="2"
        y="2"
        width="calc(100% - 4px)"
        height="calc(100% - 4px)"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray="5 5"
        filter="url(#electric-glow)"
        rx="12"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="10"
          dur="0.5s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
};

export default ElectricBorderSVG;
