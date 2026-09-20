import {createGame,type PlayerSetup} from '../../../src/games/worship-me/engine/setup.ts';
import type {GameState,PlayerColor} from '../../../src/games/worship-me/engine/types.ts';

export interface TrustedStartPlayer{userId:string;displayName:string;playerColor:string}

export function buildWorshipMeInitialState(players:TrustedStartPlayer[],seed:string):GameState{
 const specs:PlayerSetup[]=players.map(player=>({name:player.displayName,color:player.playerColor as PlayerColor,control:'human'}));
 return createGame(specs,seed);
}
