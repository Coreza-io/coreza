import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MarketInfoPayload {
  market_type: string;
  exchange: string;
  info_types: string[];
  timezone: string;
  node_id?: string;
  node_type?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: MarketInfoPayload = await req.json();
    console.log('📊 Market info request:', payload);

    const { market_type, exchange, info_types, timezone } = payload;

    // Simulate market data response
    const marketInfo: any = {
      market_type,
      exchange,
      timezone,
      timestamp: new Date().toISOString(),
      info: {}
    };

    // Add requested information types
    if (info_types.includes('status')) {
      // Simple logic: crypto markets are always open, others based on time
      const now = new Date();
      const hour = now.getUTCHours();
      
      if (market_type === 'crypto') {
        marketInfo.info.status = {
          is_open: true,
          market_state: 'OPEN',
          message: 'Cryptocurrency markets operate 24/7'
        };
      } else {
        // Simplified market hours (9 AM - 4 PM UTC for most stock markets)
        const isOpen = hour >= 9 && hour < 16;
        marketInfo.info.status = {
          is_open: isOpen,
          market_state: isOpen ? 'OPEN' : 'CLOSED',
          message: isOpen ? 'Market is currently open' : 'Market is currently closed'
        };
      }
    }

    if (info_types.includes('hours')) {
      marketInfo.info.trading_hours = {
        regular_market: {
          open: '09:30',
          close: '16:00',
          timezone: timezone
        },
        extended_hours: {
          pre_market: '04:00 - 09:30',
          after_market: '16:00 - 20:00',
          timezone: timezone
        }
      };
    }

    if (info_types.includes('next_event')) {
      const now = new Date();
      const nextDay = new Date(now);
      nextDay.setDate(now.getDate() + 1);
      nextDay.setHours(9, 30, 0, 0);
      
      marketInfo.info.next_event = {
        type: 'market_open',
        time: nextDay.toISOString(),
        description: 'Next market opening'
      };
    }

    if (info_types.includes('holidays')) {
      marketInfo.info.upcoming_holidays = [
        {
          date: '2025-12-25',
          name: 'Christmas Day',
          type: 'market_closed'
        },
        {
          date: '2025-01-01',
          name: 'New Year\'s Day',
          type: 'market_closed'
        }
      ];
    }

    if (info_types.includes('session_type')) {
      const now = new Date();
      const hour = now.getUTCHours();
      
      let sessionType = 'closed';
      if (hour >= 4 && hour < 9.5) {
        sessionType = 'pre_market';
      } else if (hour >= 9.5 && hour < 16) {
        sessionType = 'regular';
      } else if (hour >= 16 && hour < 20) {
        sessionType = 'after_market';
      }
      
      marketInfo.info.session_type = {
        current_session: sessionType,
        description: `Currently in ${sessionType.replace('_', ' ')} session`
      };
    }

    console.log('📊 Market info response:', marketInfo);

    return new Response(JSON.stringify(marketInfo), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Market info error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to get market information',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
};

serve(handler);