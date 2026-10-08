jest.mock('@/components/charts/LightweightVisualizeChart', () => ({ __esModule: true, default: jest.fn(() => null) }));

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import VisualizeNodePreview from '../src/components/nodes/visualize/VisualizeNodePreview';
import LightweightVisualizeChart from '../src/components/charts/LightweightVisualizeChart';
import { buildPreviewData } from '../src/utils/previewDataResolver';
import { ExecutionContext } from '../src/utils/executionContext';
import type { Node } from '@xyflow/react';

const bars = [{ time: 1, open: 2, high: 3, low: 1, close: 2 }];
const position = { x: 0, y: 0 };

it('renders candles and overlays from a unique legacy alias with canonical output keys', () => {
  const nodes: Node[] = [{ id: 'source', position, data: { displayName: 'Legacy', output: { bars, line: [7] } } }];
  const { allNodeData } = buildPreviewData(nodes, new ExecutionContext(), () => nodes);
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(VisualizeNodePreview, {
    fieldState: { candles: `{{ $('Legacy').json.bars }}`, overlays: [{ name: 'Line', data: `{{ $('Legacy').json.line }}` }] },
    sourceData: {}, allNodeData, nodes,
  })); });
  try {
    const viewModel = renderer.root.findByType(LightweightVisualizeChart).props.viewModel;
    expect(viewModel.candles).toEqual(bars);
    expect(viewModel.overlays[0].data).toEqual([{ time: 1, value: 7 }]);
  } finally { act(() => renderer.unmount()); }
});

it.each(['candles', 'overlay'])('renders an ambiguity diagnostic for %s instead of a chart', (target) => {
  const nodes: Node[] = ['a', 'b'].map((id) => ({ id, position, data: { displayName: 'Legacy' } }));
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(VisualizeNodePreview, {
    fieldState: target === 'candles'
      ? { candles: `{{ $('Legacy').json.bars }}` }
      : { overlays: [{ data: `{{ $('Legacy').json.line }}` }] },
    sourceData: {}, allNodeData: { a: { bars }, b: { bars } }, nodes,
  })); });
  try {
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Ambiguous node reference "Legacy"');
    expect(renderer.root.findAllByType(LightweightVisualizeChart)).toHaveLength(0);
  } finally { act(() => renderer.unmount()); }
});
