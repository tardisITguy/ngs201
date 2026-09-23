import {createGame,type PlayerSetup} from '../../../src/games/worship-me/engine/setup.ts';
import type {BotStrategy,GameState,PlayerColor} from '../../../src/games/worship-me/engine/types.ts';

export type TrustedStartPlayer=
 |{control:'human';userId:string;displayName:string;playerColor:string}
 |{control:'ai';aiPlayerId:string;displayName:string;playerColor:string;botStrategy:BotStrategy};

export function buildWorshipMeInitialState(players:TrustedStartPlayer[],seed:string):GameState{
 const specs:PlayerSetup[]=players.map(player=>player.control==='ai'
  ?{name:player.displayName,color:player.playerColor as PlayerColor,control:'ai',botStrategy:player.botStrategy}
  :{name:player.displayName,color:player.playerColor as PlayerColor,control:'human'});
 return createGame(specs,seed);
}
