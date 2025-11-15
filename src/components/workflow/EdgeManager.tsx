import React, { useMemo, useState } from 'react';
import { EdgeProps, getSmoothStepPath, MarkerType } from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';

export interface EdgeControl {
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}

export interface SelfLoopConfig {
  offsetX?: number;
  offsetY?: number;
  direction?: 'top' | 'right' | 'bottom' | 'left';
}

export interface InteractiveEdgeProps extends EdgeProps {
  controls?: EdgeControl[];
  selfLoopConfig?: SelfLoopConfig;
}

// Build edge controls based on available callbacks
const buildControls = (data?: any): EdgeControl[] => {
  const controls: EdgeControl[] = [];
  if (data?.onAddEdge) {
    controls.push({ icon: <Plus size={12} color="#22c55e" />, onClick: data.onAddEdge });
  }
  if (data?.onRemoveEdge) {
    controls.push({ icon: <Trash2 size={12} color="#e11d48" />, onClick: data.onRemoveEdge });
  }
  return controls;
};

const normalizeHex = (hex: string): string | null => {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  if (value.length === 3) {
    return `#${value
      .split('')
      .map((ch) => ch + ch)
      .join('')}`;
  }
  return `#${value}`;
};

const lightenHex = (hex: string, amount: number): string => {
  const normalized = normalizeHex(hex);
  if (!normalized) return hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const mix = (channel: number) => clamp(Math.round(channel + (255 - channel) * amount));

  return `#${[mix(r), mix(g), mix(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
};

const isExecutingClass = (className?: string): boolean => {
  if (!className) return false;
  return className.split(' ').some((cls) => cls.trim() === 'executing-edge');
};

export const PlugEdge: React.FC<InteractiveEdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  controls = [],
  selfLoopConfig,
  animated,
  className,
}) => {
  const [hovered, setHovered] = useState(false);
  const computedControls = controls.length > 0 ? controls : buildControls(data);
  const isSelfLoop = source === target;

  if (isSelfLoop) {
    return (
      <InteractiveEdge
        id={id}
        source={source}
        target={target}
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        sourcePosition={sourcePosition}
        targetPosition={targetPosition}
        style={{ stroke: '#6366f1', strokeWidth: 2, ...style }}
        markerEnd={markerEnd}
        data={data}
        controls={computedControls}
        selfLoopConfig={selfLoopConfig}
      />
    );
  }

  const customStyle: React.CSSProperties = { ...(style || {}) };
  const strokeValue = customStyle.stroke;
  const strokeWidthValue = customStyle.strokeWidth;
  delete customStyle.stroke;
  delete customStyle.strokeWidth;

  const cordColor = typeof strokeValue === 'string' ? strokeValue : '#64748b';
  const strokeWidth =
    typeof strokeWidthValue === 'number'
      ? strokeWidthValue
      : strokeWidthValue
      ? Number.parseFloat(String(strokeWidthValue)) || 3
      : 3;

  const glowColor = lightenHex(cordColor, 0.5);
  const sparkColor = lightenHex(cordColor, 0.7);
  const sparkOuter = lightenHex(cordColor, 0.85);
  const executing = isExecutingClass(className);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
  const degrees = (angle * 180) / Math.PI;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  const sparkId = useMemo(() => `plug-edge-spark-${id}`, [id]);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="plug-edge"
    >
      <defs>
        <radialGradient id={sparkId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={sparkOuter} stopOpacity={0.95} />
          <stop offset="0.55" stopColor={sparkColor} stopOpacity={0.85} />
          <stop offset="1" stopColor={sparkColor} stopOpacity={0} />
        </radialGradient>
      </defs>
      <path
        d={edgePath}
        className={`plug-edge__glow${executing ? ' plug-edge__glow--active' : ''}`}
        stroke={glowColor}
        strokeWidth={strokeWidth + 6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ pointerEvents: 'none' }}
      />
      <path
        id={id}
        d={edgePath}
        className={[
          'react-flow__edge-path',
          'plug-edge__cord',
          className || '',
          animated ? 'plug-edge__cord--animated' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        stroke={cordColor}
        strokeWidth={strokeWidth}
        markerEnd={markerEnd}
        fill="none"
        style={{
          ...customStyle,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: 'stroke',
        }}
      />
      <circle
        cx={midX}
        cy={midY}
        r={6}
        fill={`url(#${sparkId})`}
        className={`plug-edge__spark${executing ? ' plug-edge__spark--active' : ''}`}
      />
      <g
        className="plug-edge__plug"
        transform={`translate(${sourceX} ${sourceY}) rotate(${degrees})`}
      >
        <rect x={-18} y={-7} width={22} height={14} rx={5} fill="#0f172a" stroke={cordColor} strokeWidth={2} />
        <rect x={4} y={-5} width={7} height={10} rx={2} fill={glowColor} />
        <rect x={12} y={-3} width={3.5} height={6} rx={1.5} fill="#f8fafc" opacity={0.9} />
      </g>
      <g
        className="plug-edge__plug plug-edge__plug--target"
        transform={`translate(${targetX} ${targetY}) rotate(${degrees + 180})`}
      >
        <rect x={-18} y={-7} width={22} height={14} rx={5} fill="#0f172a" stroke={cordColor} strokeWidth={2} />
        <rect x={4} y={-5} width={7} height={10} rx={2} fill={glowColor} />
        <rect x={12} y={-3} width={3.5} height={6} rx={1.5} fill="#f8fafc" opacity={0.9} />
      </g>
      {data?.label && (
        <text className="react-flow__edge-text">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      {computedControls.length > 0 && hovered && (
        <foreignObject
          x={labelX - 24}
          y={labelY - 12}
          width={48}
          height={24}
          style={{ pointerEvents: 'all' }}
        >
          <div
            style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}
          >
            {computedControls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  padding: '2px',
                  cursor: 'pointer',
                }}
              >
                {ctrl.icon}
              </button>
            ))}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

export const InteractiveEdge: React.FC<InteractiveEdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  controls = [],
  selfLoopConfig,
}) => {
  // Detect self-loop (when source connects to target on same node)
  const isSelfLoop = source === target;
  
  // Default self-loop configuration
  const defaultSelfLoopConfig: SelfLoopConfig = {
    offsetX: 40,
    offsetY: 80,
    direction: 'right'
  };
  
  const loopConfig = { ...defaultSelfLoopConfig, ...selfLoopConfig };
  
  let pathD: string;
  let midX: number;
  let midY: number;
  if (isSelfLoop) {
    // Create self-loop path based on direction
    const { offsetX = 40, offsetY = 80, direction = 'right' } = loopConfig;
    
    switch (direction) {
      case 'top':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `V ${sourceY - offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY - offsetY;
        break;
      case 'bottom':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `V ${sourceY + offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY + offsetY;
        break;
      case 'left':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX - offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX}`,
          `V ${targetY}`,
        ].join(' ');
        midX = sourceX - offsetX;
        midY = sourceY + offsetY / 2;
        break;
      case 'right':
      default:
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX + offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX - offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX;
        midY = sourceY + offsetY / 2;
        break;
    }
  } else {
    // Regular edge path
    pathD = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
    midX = (sourceX + targetX) / 2;
    midY = (sourceY + targetY) / 2;
  }

  const [hovered, setHovered] = useState(false);

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <path
        id={id}
        className="react-flow__edge-path"
        d={pathD}
        style={{
          ...style,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: 'stroke',
        }}
        markerEnd={markerEnd}
      />
      {data?.label && (
        <text className="react-flow__edge-text">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      {controls.length > 0 && hovered && (
        <foreignObject
          x={midX - 24}
          y={midY - 12}
          width={48}
          height={24}
          style={{ pointerEvents: 'all' }}
        >
          <div
            style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}
          >
            {controls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  padding: '2px',
                  cursor: 'pointer',
                }}
              >
                {ctrl.icon}
              </button>
            ))}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

// Generic Self-Loop Edge for any node
export const SelfLoopEdge: React.FC<EdgeProps> = (props) => {
  const { data, source, target } = props;
  
  // Only apply self-loop styling if it's actually a self-loop
  if (source !== target) {
    return <DefaultEdge {...props} />;
  }

  const controls = buildControls(data);

  return (
    <InteractiveEdge
      {...props}
      selfLoopConfig={{
        offsetX: (data?.offsetX as number) || 40,
        offsetY: (data?.offsetY as number) || 80,
        direction: (data?.direction as 'top' | 'right' | 'bottom' | 'left') || 'right'
      }}
      style={{ stroke: (data?.loopColor as string) || '#6366f1', strokeWidth: 2, strokeDasharray: '5,5' }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

// Default edge for regular connections
export const DefaultEdge: React.FC<EdgeProps> = (props) => {
  const { data } = props;
  const controls = buildControls(data);
  return (
    <PlugEdge
      {...props}
      controls={controls}
      data={data}
      style={{ stroke: '#64748b', strokeWidth: 3, ...props.style }}
    />
  );
};

// Keep LoopEdge for backward compatibility with existing Loop nodes
export const LoopEdge: React.FC<EdgeProps> = (props) => {
  const { data } = props;
  const controls = buildControls(data);

  return (
    <InteractiveEdge
      {...props}
      selfLoopConfig={{ offsetX: 20, offsetY: 80, direction: 'right' }}
      style={{ stroke: '#22c55e', strokeWidth: 3 }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

const EdgeManager = {
  InteractiveEdge,
  PlugEdge,
  SelfLoopEdge,
  DefaultEdge,
  LoopEdge,
  RemovableEdge: DefaultEdge,
};
export default EdgeManager;

