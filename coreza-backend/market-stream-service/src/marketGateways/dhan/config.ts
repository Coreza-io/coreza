import { encodeDhanSubscribeMessage, encodeDhanUnsubscribeMessage } from "../../utils/dhanBinaryParser";
import { GatewayConfig } from '../types';
import {
  buildDhanSubscribeMessage,
  buildDhanUnsubscribeMessage,
  identifyDhanMessageType,
  normalizeDhanMessage,
  parseDhanMessage,
  shouldPublishDhanMessage,
} from './helpers';

export const dhanGatewayConfig: GatewayConfig = {
  id: 'dhan',
  wsUrl: (creds, _source) =>
    `wss://api-feed.dhan.co?version=2&token=${creds.api_key}&clientId=${creds.client_id}&authType=2`,
  makeAuthMessage: undefined,
  makeSubscribeMessage: (streamNames, _source) => buildDhanSubscribeMessage(streamNames),
  makeUnsubscribeMessage: (streamNames, _source) => buildDhanUnsubscribeMessage(streamNames),
  parseMessage: (buffer) => parseDhanMessage(buffer),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg, _source) => shouldPublishDhanMessage(msg),
  normalize: (msg, _source) => normalizeDhanMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  isBinary: true,
  encodeMessage: (msg) => {
    if (msg?.RequestCode === 15) return encodeDhanSubscribeMessage(msg.InstrumentList.map((i: any) => i.SecurityId), msg.InstrumentList[0]?.ExchangeSegment || "NSE_EQ");
    if (msg?.RequestCode === 16) return encodeDhanUnsubscribeMessage(msg.InstrumentList.map((i: any) => i.SecurityId), msg.InstrumentList[0]?.ExchangeSegment || "NSE_EQ");
    return Buffer.from(JSON.stringify(msg));
  },
};
