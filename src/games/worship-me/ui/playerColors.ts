import type {PlayerColor} from '../engine/types';

export const WORSHIP_ME_PLAYER_COLORS=['red','purple','blue','cyan','green','yellow','orange','black'] as const satisfies readonly PlayerColor[];
export const WORSHIP_ME_PLAYER_COLOR_HEX:Record<PlayerColor,string>={red:'#d7191c',purple:'#7b1fa2',blue:'#2864dc',cyan:'#00a9c7',green:'#2e8b57',yellow:'#d9b300',orange:'#e87520',black:'#191919'};
