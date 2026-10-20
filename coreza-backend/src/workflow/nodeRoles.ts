/** Portable attachment contract shared by the editor and server. */
export const BACKTEST_PROVIDERS: Record<string, string> = {
  Alpaca: 'alpaca', Schwab: 'schwab', Binance: 'binance', Dhan: 'dhan',
};
export const nodeValues = (node: any): Record<string, any> => node?.data?.values ?? node?.values ?? {};
export const nodeDefinition = (node: any): any => node?.data?.definition ?? node;
export const isBacktestBroker = (node: any): boolean => nodeValues(node).__attachmentRole === 'backtestBroker';
export const isSupportNode = (node: any): boolean => isBacktestBroker(node) || nodeValues(node).__isTool === true || nodeDefinition(node)?.node_type === 'sub';
export function effectiveHandles(definition: any, values: Record<string, any> = {}): any[] {
  if (values.__attachmentRole === 'backtestBroker') return [{type: 'source', position: 'top', id: 'broker', connectionKind: 'attachment'}];
  if (values.__isTool === true) return [{type: 'source', position: 'top', id: 'tool', connectionKind: 'attachment'}];
  return definition?.handles ?? [];
}
export function isAttachmentEdge(edge: any, nodes: readonly any[]): boolean {
  const source = nodes.find(n => n.id === edge.source);
  const target = nodes.find(n => n.id === edge.target);
  return isSupportNode(source) || effectiveHandles(nodeDefinition(target), nodeValues(target))
    .some(h => h.type === 'target' && h.id === edge.targetHandle && h.connectionKind === 'attachment');
}
/** Incomplete graphs are saveable; malformed or conflicting attachments are not. */
export function validateBrokerAttachments(nodes: readonly any[], edges: readonly any[]): void {
  for (const node of nodes) {
    const values = nodeValues(node);
    if (values.__attachmentRole != null && values.__attachmentRole !== 'backtestBroker') throw new Error('Unknown attachment role.');
    if (!isBacktestBroker(node)) continue;
    if (!BACKTEST_PROVIDERS[nodeDefinition(node)?.name] || values.__isTool === true) throw new Error('Choose one supported broker role per node.');
    if (edges.some(e => e.target === node.id || (e.source === node.id && (e.sourceHandle !== 'broker' || e.targetHandle !== 'broker' || nodeDefinition(nodes.find(n => n.id === e.target))?.name !== 'BacktestInit')))) {
      throw new Error('Disconnect existing edges before changing the broker role.');
    }
  }
  for (const init of nodes.filter(n => nodeDefinition(n)?.name === 'BacktestInit')) {
    const incoming = edges.filter(e => e.target === init.id);
    if (incoming.length > 1) throw new Error('Backtest Init already has a broker. Reconnect or remove the existing connection.');
    for (const edge of incoming) {
      const source = nodes.find(n => n.id === edge.source);
      if (!source) throw new Error('The attached broker node no longer exists.');
      if (source.id === init.id || edge.sourceHandle !== 'broker' || edge.targetHandle !== 'broker' || !isBacktestBroker(source) || !BACKTEST_PROVIDERS[nodeDefinition(source)?.name]) {
        throw new Error('Connect a broker in Backtest Broker mode to the Broker input.');
      }
    }
  }
}
