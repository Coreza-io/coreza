import type { AlpacaWsChannel } from './channels';

export function toAlpacaChannelList(channels: AlpacaWsChannel[]): AlpacaWsChannel[] {
  return Array.from(new Set(channels));
}
