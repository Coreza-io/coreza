import React from 'react';

// Alpaca SVG as React component for instant rendering
export const AlpacaIcon: React.FC<{ className?: string }> = ({ className = "w-10 h-10" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="15" fill="#FCD72B" stroke="#E6C043" strokeWidth="2"/>
    <ellipse cx="16" cy="13" rx="8" ry="6" fill="#FFFFFF" stroke="#333" strokeWidth="1"/>
    <circle cx="13" cy="11" r="1.5" fill="#333"/>
    <circle cx="19" cy="11" r="1.5" fill="#333"/>
    <circle cx="13.5" cy="10.5" r="0.5" fill="#FFF"/>
    <circle cx="19.5" cy="10.5" r="0.5" fill="#FFF"/>
    <ellipse cx="16" cy="14" rx="1" ry="0.5" fill="#E6C043"/>
    <ellipse cx="12" cy="8" rx="1.5" ry="2.5" fill="#FCD72B"/>
    <ellipse cx="20" cy="8" rx="1.5" ry="2.5" fill="#FCD72B"/>
    <ellipse cx="16" cy="24" rx="5" ry="4" fill="#FCD72B" opacity="0.7"/>
    <text x="16" y="28" textAnchor="middle" fill="#333" fontFamily="Arial, sans-serif" fontSize="3" fontWeight="bold">ALPACA</text>
  </svg>
);

// EMA SVG as React component for instant rendering
export const EMAIcon: React.FC<{ className?: string }> = ({ className = "w-10 h-10" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="15" fill="#F8FAFC" stroke="#3B82F6" strokeWidth="2"/>
    <path d="M6 12H26M6 20H26" stroke="#E5E7EB" strokeWidth="0.5"/>
    <path d="M10 8V24M16 8V24M22 8V24" stroke="#E5E7EB" strokeWidth="0.5"/>
    <path d="M6 18L9 15L12 17L15 14L18 16L21 13L24 15L26 12" stroke="#6B7280" strokeWidth="1.5" fill="none"/>
    <path d="M6 19L9 16.5L12 17.5L15 15.5L18 16.5L21 14.5L24 15.5L26 13.5" stroke="#3B82F6" strokeWidth="2" fill="none"/>
    <text x="16" y="8" textAnchor="middle" fill="#3B82F6" fontFamily="Arial, sans-serif" fontSize="4" fontWeight="bold">EMA</text>
  </svg>
);

// If SVG as React component for instant rendering
export const IfIcon: React.FC<{ className?: string }> = ({ className = "w-10 h-10" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
    {/* Background circle */}
    <circle cx="16" cy="16" r="15" fill="#F8FAFC" stroke="#8B5CF6" strokeWidth="2"/>
    
    {/* Diamond shape for decision */}
    <path d="M16 6L24 16L16 26L8 16Z" fill="#8B5CF6" stroke="#7C3AED" strokeWidth="1"/>
    
    {/* Question mark */}
    <path d="M13 12C13 10.3431 14.3431 9 16 9C17.6569 9 19 10.3431 19 12C19 13.1046 18.1046 14 17 14H16V16" 
          stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <circle cx="16" cy="19" r="1" fill="#FFFFFF"/>
    
    {/* Branching arrows */}
    <path d="M24 16L28 12M24 16L28 20" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 16L4 12M8 16L4 20" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
    
    {/* Labels */}
    <text x="30" y="10" textAnchor="middle" fill="#8B5CF6" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">Y</text>
    <text x="30" y="23" textAnchor="middle" fill="#8B5CF6" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">N</text>
  </svg>
);

// Switch SVG as React component for instant rendering
export const SwitchIcon: React.FC<{ className?: string }> = ({ className = "w-10 h-10" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
    {/* Background circle */}
    <circle cx="16" cy="16" r="15" fill="#F8FAFC" stroke="#F97316" strokeWidth="2"/>
    
    {/* Central hub */}
    <circle cx="16" cy="16" r="4" fill="#F97316" stroke="#EA580C" strokeWidth="1"/>
    
    {/* Input line from left */}
    <path d="M2 16L12 16" stroke="#6B7280" strokeWidth="2" strokeLinecap="round"/>
    
    {/* Output branches to right */}
    <path d="M20 16L28 8" stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
    <path d="M20 16L28 12" stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
    <path d="M20 16L28 20" stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
    <path d="M20 16L28 24" stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
    
    {/* Small circles at branch endpoints */}
    <circle cx="28" cy="8" r="1.5" fill="#F97316"/>
    <circle cx="28" cy="12" r="1.5" fill="#F97316"/>
    <circle cx="28" cy="20" r="1.5" fill="#F97316"/>
    <circle cx="28" cy="24" r="1.5" fill="#F97316"/>
    
    {/* Labels */}
    <text x="30" y="6" textAnchor="middle" fill="#F97316" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">1</text>
    <text x="30" y="10" textAnchor="middle" fill="#F97316" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">2</text>
    <text x="30" y="18" textAnchor="middle" fill="#F97316" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">3</text>
    <text x="30" y="22" textAnchor="middle" fill="#F97316" fontFamily="Arial, sans-serif" fontSize="2" fontWeight="bold">D</text>
  </svg>
);

// Icon registry for easy access
export const IconRegistry = {
  'Alpaca': AlpacaIcon,
  'EMA': EMAIcon,
  'If': IfIcon,
  'Switch': SwitchIcon,
} as const;

export type IconName = keyof typeof IconRegistry;