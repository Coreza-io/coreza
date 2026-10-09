jest.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => [], getEdges: () => [] }) }));

import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Node } from '@xyflow/react';
import { StableNodeProvider, useCanonicalGraphSync } from '../src/contexts/StableNodeContext';
import { canRenameEditorNodeAction, clearEditorNodeActions, executeEditorNode, registerEditorNodeAction } from '../src/services/editorNodeExecution';

const session = 'canonical-action-lifecycle';
const ActionHost = ({ id }: { id: string }) => {
  useEffect(() => registerEditorNodeAction(session, id, async () => ({ nodeId: id, status: 'success', output: id })), [id]);
  return null;
};
const DocumentHost = ({ nodes, visible }: { nodes: Node[]; visible: boolean }) => {
  useCanonicalGraphSync(nodes, [], session);
  return visible ? React.createElement(ActionHost, { id: nodes[0].id, key: nodes[0].id }) : null;
};
const tree = (id: string, visible = true) => React.createElement(StableNodeProvider, {
  children: React.createElement(DocumentHost, { nodes: [{ id, position: { x: 0, y: 0 }, data: {} }], visible }),
});

it('registers fresh identities after canonical rename and retains their actions when cluster hosts unmount', async () => {
  let renderer!: ReactTestRenderer;
  try {
    act(() => { renderer = create(tree('member')); });
    await expect(executeEditorNode(session, 'member')).resolves.toMatchObject({ output: 'member' });
    act(() => { renderer.update(tree('hh')); });
    expect(canRenameEditorNodeAction(session, 'hh', 'member')).toBe(true);
    await expect(executeEditorNode(session, 'member')).resolves.toMatchObject({ status: 'failed' });
    await expect(executeEditorNode(session, 'hh')).resolves.toMatchObject({ output: 'hh' });
    act(() => { renderer.update(tree('hh', false)); });
    await expect(executeEditorNode(session, 'hh')).resolves.toMatchObject({ output: 'hh' });
    act(() => { renderer.update(tree('member')); });
    await expect(executeEditorNode(session, 'hh')).resolves.toMatchObject({ status: 'failed' });
    await expect(executeEditorNode(session, 'member')).resolves.toMatchObject({ output: 'member' });
  } finally {
    if (renderer) act(() => renderer.unmount());
    clearEditorNodeActions(session);
  }
});
