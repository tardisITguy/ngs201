import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {BotStrategy} from '../../games/worship-me/engine/types';

export interface HumanLobbyPlayer{control:'human';participantId:string;userId:string;displayName:string;playerColor:string|null;turnOrder:number|null;isReady:boolean;isHost:boolean;isCurrentUser:boolean}
export interface AILobbyPlayer{control:'ai';participantId:string;aiPlayerId:string;botNumber:number;displayName:string;playerColor:string;turnOrder:number|null;botStrategy:BotStrategy;isHost:false;isCurrentUser:false}
export type LobbyPlayer=HumanLobbyPlayer|AILobbyPlayer;
export interface Lobby{room:{id:string;code:string;status:string;gameId:string;maxPlayers:number;joinMode:'public'|'code';isCurrentUserHost:boolean};players:LobbyPlayer[]}
export class LobbyReadError extends Error{constructor(message="You don't have access to this room."){super(message);this.name='LobbyReadError'}}

export async function getLobby(roomCode:string,client=getSupabaseClient()):Promise<Lobby>{
 const {user}=await ensureAnonymousSession(client),code=roomCode.trim().toUpperCase();if(!/^[A-Z0-9]{6,10}$/.test(code))throw new LobbyReadError('That room code is not valid.');
 const roomResult=await client.from('rooms').select('id,code,status,game_id,host_user_id,join_mode,games(max_players)').eq('code',code).maybeSingle();if(roomResult.error||!roomResult.data)throw new LobbyReadError();const room=roomResult.data as Record<string,unknown>,game=Array.isArray(room.games)?room.games[0]:room.games;if(typeof room.id!=='string'||typeof room.code!=='string'||typeof room.status!=='string'||typeof room.game_id!=='string'||typeof room.host_user_id!=='string'||(room.join_mode!=='public'&&room.join_mode!=='code')||!game||typeof game!=='object'||!Number.isInteger((game as Record<string,unknown>).max_players))throw new LobbyReadError();
 const [humanResult,aiResult]=await Promise.all([
  client.from('room_players').select('user_id,display_name,player_color,turn_order,is_ready,joined_at').eq('room_id',room.id).order('joined_at').order('user_id'),
  client.from('room_ai_players').select('id,bot_number,player_color,turn_order,bot_strategy').eq('room_id',room.id).order('bot_number'),
 ]);
 if(humanResult.error||aiResult.error||!Array.isArray(humanResult.data)||!Array.isArray(aiResult.data))throw new LobbyReadError();
 const humans:HumanLobbyPlayer[]=humanResult.data.map(value=>{const player=value as Record<string,unknown>;if(typeof player.user_id!=='string'||typeof player.display_name!=='string'||typeof player.is_ready!=='boolean')throw new LobbyReadError();return{control:'human',participantId:player.user_id,userId:player.user_id,displayName:player.display_name,playerColor:typeof player.player_color==='string'?player.player_color:null,turnOrder:typeof player.turn_order==='number'?player.turn_order:null,isReady:player.is_ready,isHost:player.user_id===room.host_user_id,isCurrentUser:player.user_id===user.id};});
 const bots:AILobbyPlayer[]=aiResult.data.map(value=>{const bot=value as Record<string,unknown>;if(typeof bot.id!=='string'||!Number.isInteger(bot.bot_number)||typeof bot.player_color!=='string'||!['random','growth','templeRush','balanced'].includes(bot.bot_strategy as string))throw new LobbyReadError();return{control:'ai',participantId:bot.id,aiPlayerId:bot.id,botNumber:bot.bot_number as number,displayName:`AI ${bot.bot_number}`,playerColor:bot.player_color,turnOrder:typeof bot.turn_order==='number'?bot.turn_order:null,botStrategy:bot.bot_strategy as BotStrategy,isHost:false,isCurrentUser:false};});
 return{room:{id:room.id,code:room.code,status:room.status,gameId:room.game_id,maxPlayers:(game as Record<string,unknown>).max_players as number,joinMode:room.join_mode,isCurrentUserHost:room.host_user_id===user.id},players:[...humans,...bots]};
}
