import React, { useMemo, useState } from 'react';
import {
  ConnectionLineComponentProps,
  EdgeProps,
  getSmoothStepPath,
  MarkerType,
} from '@xyflow/react';
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

const FEMALE_PLUG_PATH =
  'm12.707,12.707l-2.293,2.293-1.414-1.414,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0l-2.293,2.293-1.879-1.879c-.391-.391-1.023-.391-1.414,0s-.391,1.023,0,1.414l.352.352-1.134,1.135c-1.77,1.769-1.982,4.515-.638,6.519l-2.58,2.58c-.391.391-.391,1.023,0,1.414.195.195.451.293.707.293s.512-.098.707-.293l2.58-2.58c.865.58,1.868.871,2.871.871,1.321,0,2.642-.503,3.647-1.509l1.135-1.134.352.352c.195.195.451.293.707.293s.512-.098.707-.293c.391-.391.391-1.023,0-1.414l-1.879-1.879,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0Zm-3.315,6.368c-1.232,1.23-3.234,1.23-4.467,0-1.231-1.231-1.231-3.235,0-4.467l1.134-1.135,4.467,4.467-1.135,1.134Z';

const MALE_PLUG_PATH =
  'M 23.707 0.293 c -0.391 -0.391 -1.023 -0.391 -1.414 0 l -2.58 2.58 c -2.004 -1.344 -4.749 -1.132 -6.519 0.638 l -1.135 1.135 l -0.353 -0.353 c -0.391 -0.391 -1.023 -0.391 -1.414 0 s -0.391 1.023 0 1.414 l 8 8 c 0.195 0.195 0.451 0.293 0.707 0.293 s 0.512 -0.098 0.707 -0.293 c 0.391 -0.391 0.391 -1.023 0 -1.414 l -0.353 -0.353 l 1.135 -1.135 c 1.77 -1.769 1.982 -4.515 0.638 -6.519 l 2.58 -2.58 c 0.391 -0.391 0.391 -1.023 0 -1.414 Z';
interface PlugIconProps {
  color?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const mergeIconStyle = (style?: React.CSSProperties): React.CSSProperties => ({
  pointerEvents: 'none',
  transformOrigin: 'center',
  ...(style ?? {}),
});

export const MalePlugIcon: React.FC<PlugIconProps> = ({
  color = '#64748b',
  size = 24,
  className,
  style,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    style={mergeIconStyle(style)}
  >
    <path d={MALE_PLUG_PATH} fill={color} />
  </svg>
);

export const FemalePlugIcon: React.FC<PlugIconProps> = ({
  color = '#64748b',
  size = 24,
  className,
  style,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    style={mergeIconStyle(style)}
  >
    <path d={FEMALE_PLUG_PATH} fill={color} />
  </svg>
);


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

export const PlugConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineStyle,
  connectionStatus,
  fromHandle,
}) => {
  const style: React.CSSProperties = { ...(connectionLineStyle || {}) };

  const baseStroke =
    typeof style.stroke === 'string'
      ? style.stroke
      : connectionStatus === 'invalid'
      ? '#ef4444'
      : '#64748b';

  const strokeWidth =
    typeof style.strokeWidth === 'number'
      ? style.strokeWidth
      : style.strokeWidth
      ? Number.parseFloat(String(style.strokeWidth)) || 3
      : 3;

  const cordColor = connectionStatus === 'invalid' ? '#ef4444' : baseStroke;
  const glowColor = lightenHex(cordColor, 0.5);

  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  const fromType = fromHandle?.type ?? 'source';
  const draggingFromSource = fromType === 'source';

  const anchorX = draggingFromSource ? fromX : toX;
  const anchorY = draggingFromSource ? fromY : toY;
  const pointerX = draggingFromSource ? toX : fromX;
  const pointerY = draggingFromSource ? toY : fromY;

  const angle = Math.atan2(pointerY - anchorY, pointerX - anchorX);
  const degrees = (angle * 180) / Math.PI;
  return (
    <g className="plug-edge plug-edge--connection">
      <path
        d={edgePath}
        className="plug-edge__glow"
        stroke={glowColor}
        strokeWidth={strokeWidth + 6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ pointerEvents: 'none' }}
      />
      <path
        d={edgePath}
        className="plug-edge__cord"
        stroke={cordColor}
        strokeWidth={strokeWidth}
        fill="none"
        style={{
          ...style,
          stroke: cordColor,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: 'stroke',
        }}
      />
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
  PlugConnectionLine,
  SelfLoopEdge,
  DefaultEdge,
  LoopEdge,
  RemovableEdge: DefaultEdge,
};
export default EdgeManager;

