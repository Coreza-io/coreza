/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Radio, 
  Activity, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  Search,
  ExternalLink,
  Loader2,
  TrendingUp,
  X,
  Trash2
} from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

interface SourceStatus {
  source: string;
  connected: boolean;
  symbols: string[];
  eventTypes: string[];
  connectedAt: string | null;
  lastMessageAt: string | null;
}

interface WorkflowSubscription {
  workflowId: string;
  workflowName: string;
  nodeId: string;
  symbols: string[];
  eventTypes: string[];
  source: string;
  isActive: boolean;
}

interface SubscriptionStats {
  totalSources: number;
  totalSymbols: number;
  totalWorkflows: number;
  connectedSources: string[];
}

interface SubscriptionStatus {
  sources: SourceStatus[];
  workflows: WorkflowSubscription[];
  stats: SubscriptionStats;
  symbolSourceMap: Record<string, string[]>;
}

const sourceColors: Record<string, string> = {
  alpaca: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  binance: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  dhan: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  schwab: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const sourceIcons: Record<string, string> = {
  alpaca: "🦙",
  binance: "₿",
  dhan: "📊",
  schwab: "💼",
};

const MarketSubscriptions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<SubscriptionStatus | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'symbol' | 'workflow' | 'source';
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, type: 'symbol', title: '', description: '', onConfirm: () => {} });

  const fetchStatus = useCallback(async (showRefreshToast = false) => {
    if (!user) return;
    
    try {
      if (showRefreshToast) setRefreshing(true);
      
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      const response = await fetch(`${backendUrl}/market/subscriptions/status?user_id=${user.id}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch subscription status');
      }
      
      const result = await response.json();
      setData(result);
      
      if (showRefreshToast) {
        toast({
          title: "Refreshed",
          description: "Subscription status updated",
        });
      }
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      toast({
        title: "Error",
        description: "Failed to load subscription status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, toast]);

  const handleUnsubscribeSymbol = useCallback(async (symbol: string, source: string) => {
    if (!user) return;
    
    setUnsubscribing(`symbol-${symbol}`);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      // Source may already have _stream suffix or not
      const sourceRoute = source.endsWith('_stream') ? source : `${source}_stream`;
      const response = await fetch(`${backendUrl}/market/${sourceRoute}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          symbols: [symbol],
        }),
      });
      
      if (!response.ok) throw new Error('Failed to unsubscribe');
      
      toast({ title: "Unsubscribed", description: `Removed ${symbol} from ${source}` });
      fetchStatus(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to unsubscribe symbol", variant: "destructive" });
    } finally {
      setUnsubscribing(null);
    }
  }, [user, toast, fetchStatus]);

  const handleUnsubscribeWorkflow = useCallback(async (wf: WorkflowSubscription) => {
    if (!user) return;
    
    setUnsubscribing(`workflow-${wf.workflowId}-${wf.nodeId}`);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      
      // Use fallback endpoint when source is unknown
      let response: Response;
      if (!wf.source || wf.source === 'unknown') {
        response = await fetch(`${backendUrl}/market/workflows/${wf.workflowId}/unsubscribe?user_id=${user.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // Source may already have _stream suffix (e.g., "binance_stream") or not (e.g., "binance")
        const sourceRoute = wf.source.endsWith('_stream') ? wf.source : `${wf.source}_stream`;
        response = await fetch(`${backendUrl}/market/${sourceRoute}/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            workflow_id: wf.workflowId,
            node_id: wf.nodeId,
            symbols: wf.symbols,
          }),
        });
      }
      
      if (!response.ok) throw new Error('Failed to unsubscribe');
      
      toast({ title: "Unsubscribed", description: `${wf.workflowName} removed from market data` });
      fetchStatus(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to unsubscribe workflow", variant: "destructive" });
    } finally {
      setUnsubscribing(null);
    }
  }, [user, toast, fetchStatus]);

  const handleClearSource = useCallback(async (source: string, symbols: string[]) => {
    if (!user || symbols.length === 0) return;
    
    setUnsubscribing(`source-${source}`);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      // Source may already have _stream suffix or not
      const sourceRoute = source.endsWith('_stream') ? source : `${source}_stream`;
      const response = await fetch(`${backendUrl}/market/${sourceRoute}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          symbols: symbols,
        }),
      });
      
      if (!response.ok) throw new Error('Failed to unsubscribe');
      
      toast({ title: "Cleared", description: `All ${source} subscriptions removed` });
      fetchStatus(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to clear source", variant: "destructive" });
    } finally {
      setUnsubscribing(null);
    }
  }, [user, toast, fetchStatus]);

  const confirmUnsubscribeSymbol = (symbol: string, source: string) => {
    setConfirmDialog({
      open: true,
      type: 'symbol',
      title: `Unsubscribe ${symbol}?`,
      description: `This will stop streaming ${symbol} data from ${source}. Any workflows using this symbol will no longer receive updates.`,
      onConfirm: () => handleUnsubscribeSymbol(symbol, source),
    });
  };

  const confirmUnsubscribeWorkflow = (wf: WorkflowSubscription) => {
    setConfirmDialog({
      open: true,
      type: 'workflow',
      title: `Unsubscribe ${wf.workflowName}?`,
      description: `This will stop ${wf.workflowName} from receiving market data for ${wf.symbols.length} symbol(s).`,
      onConfirm: () => handleUnsubscribeWorkflow(wf),
    });
  };

  const confirmClearSource = (source: string, symbols: string[]) => {
    setConfirmDialog({
      open: true,
      type: 'source',
      title: `Clear all ${source} subscriptions?`,
      description: `This will unsubscribe all ${symbols.length} symbol(s) from ${source}. All workflows using these symbols will stop receiving data.`,
      onConfirm: () => handleClearSource(source, symbols),
    });
  };

  useEffect(() => {
    fetchStatus();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchStatus(), 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const filteredWorkflows = data?.workflows.filter(wf => 
    symbolFilter === "" || 
    wf.symbols.some(s => s.toLowerCase().includes(symbolFilter.toLowerCase())) ||
    wf.workflowName.toLowerCase().includes(symbolFilter.toLowerCase())
  ) || [];

  const allSymbols = new Set<string>();
  data?.sources.forEach(s => s.symbols.forEach(sym => allSymbols.add(sym)));
  data?.workflows.forEach(w => w.symbols.forEach(sym => allSymbols.add(sym)));

  const filteredSymbols = Array.from(allSymbols).filter(sym =>
    symbolFilter === "" || sym.toLowerCase().includes(symbolFilter.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading subscriptions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog(prev => ({ ...prev, open: false }));
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Unsubscribe
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Radio className="h-8 w-8 text-primary" />
            Market Data Subscriptions
          </h1>
          <p className="text-muted-foreground">
            Monitor active market data streams and workflow receivers
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => fetchStatus(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 md:grid-cols-4"
      >
        <Card className="bg-gradient-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Connected Sources</CardTitle>
            <Wifi className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.stats.totalSources || 0}</div>
            <p className="text-xs text-muted-foreground">
              {data?.stats.connectedSources.join(', ') || 'None'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subscribed Symbols</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.stats.totalSymbols || 0}</div>
            <p className="text-xs text-muted-foreground">Across all sources</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
            <Activity className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.stats.totalWorkflows || 0}</div>
            <p className="text-xs text-muted-foreground">Receiving market data</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
            <Radio className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.sources.length || 0}</div>
            <p className="text-xs text-muted-foreground">Configured gateways</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Source Status Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Data Source Status
            </CardTitle>
            <CardDescription>Real-time connection status for each broker</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {['alpaca', 'binance', 'dhan', 'schwab'].map(source => {
                const sourceData = data?.sources.find(s => s.source === source);
                const isConnected = sourceData?.connected || false;
                
                return (
                  <Card 
                    key={source} 
                    className={`border ${isConnected ? 'border-success/30 bg-success/5' : 'border-muted bg-muted/5'}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{sourceIcons[source]}</span>
                          <span className="font-semibold capitalize">{source}</span>
                        </div>
                        {isConnected ? (
                          <Badge variant="outline" className="bg-success/20 text-success border-success/30">
                            <Wifi className="h-3 w-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-muted text-muted-foreground">
                            <WifiOff className="h-3 w-3 mr-1" />
                            Offline
                          </Badge>
                        )}
                      </div>
                      
                      {sourceData && (
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Symbols:</span>
                            <span className="font-medium">{sourceData.symbols.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Events:</span>
                            <span className="font-medium">{sourceData.eventTypes.length}</span>
                          </div>
                          {sourceData.eventTypes.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {sourceData.eventTypes.slice(0, 3).map(type => (
                                <Badge key={type} variant="secondary" className="text-xs">
                                  {type}
                                </Badge>
                              ))}
                              {sourceData.eventTypes.length > 3 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{sourceData.eventTypes.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                          {sourceData.symbols.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full mt-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => confirmClearSource(source, sourceData.symbols)}
                              disabled={unsubscribing === `source-${source}`}
                            >
                              {unsubscribing === `source-${source}` ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3 mr-1" />
                              )}
                              Clear All
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Search/Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by symbol or workflow name..."
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Workflow Receivers Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Workflow Receivers
            </CardTitle>
            <CardDescription>Workflows currently receiving market data streams</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Symbols</TableHead>
                    <TableHead>Event Types</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkflows.length > 0 ? (
                    filteredWorkflows.map((wf, idx) => (
                      <TableRow key={`${wf.workflowId}-${wf.nodeId}-${idx}`}>
                        <TableCell className="font-medium">
                          {wf.workflowName}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={sourceColors[wf.source] || 'bg-muted'}
                          >
                            {sourceIcons[wf.source] || '📡'} {wf.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {wf.symbols.slice(0, 3).map(sym => (
                              <Badge key={sym} variant="secondary" className="text-xs">
                                {sym}
                              </Badge>
                            ))}
                            {wf.symbols.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{wf.symbols.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {wf.eventTypes.map(type => (
                              <Badge key={type} variant="outline" className="text-xs">
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={wf.isActive ? "default" : "secondary"}
                            className={wf.isActive ? "bg-success/20 text-success" : ""}
                          >
                            {wf.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => confirmUnsubscribeWorkflow(wf)}
                              disabled={unsubscribing === `workflow-${wf.workflowId}-${wf.nodeId}`}
                            >
                              {unsubscribing === `workflow-${wf.workflowId}-${wf.nodeId}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                            <Link to={`/dashboard/workflow/${wf.workflowId}`}>
                              <Button variant="ghost" size="sm">
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {symbolFilter ? "No matching workflows found" : "No active market data subscriptions"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </motion.div>

      {/* Subscribed Symbols */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Subscribed Symbols
            </CardTitle>
            <CardDescription>All symbols currently being streamed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {filteredSymbols.length > 0 ? (
                filteredSymbols.map(symbol => {
                  const sources = data?.symbolSourceMap?.[symbol] || [];
                  const primarySource = sources[0] || 'alpaca';
                  
                  return (
                    <Badge 
                      key={symbol} 
                      variant="outline" 
                      className="px-2 py-1 text-sm font-mono flex items-center gap-1 group"
                    >
                      {symbol}
                      <button
                        onClick={() => confirmUnsubscribeSymbol(symbol, primarySource)}
                        disabled={unsubscribing === `symbol-${symbol}`}
                        className="ml-1 opacity-50 group-hover:opacity-100 hover:text-destructive transition-opacity"
                      >
                        {unsubscribing === `symbol-${symbol}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    </Badge>
                  );
                })
              ) : (
                <p className="text-muted-foreground">
                  {symbolFilter ? "No matching symbols found" : "No symbols subscribed"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default MarketSubscriptions;
