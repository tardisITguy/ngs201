/** Generic NGSLLC platform records exposed to authenticated clients. */
import type {WorshipMePublicGameView} from '../games/worship-me/publicGameView';
import type {WorshipMeBrowserCommand} from '../games/worship-me/trustedGameCommand';
import type {BotStrategy} from '../games/worship-me/engine/types';
export interface GameRecord {
 id:string;
 slug:string;
 name:string;
 status:'active'|'disabled';
 min_players:number;
 max_players:number;
 created_at:string;
 updated_at:string;
}

export interface RoomRecord {
 id:string;
 game_id:string;
 code:string;
 host_user_id:string;
 status:'lobby'|'active'|'finished'|'abandoned';
 join_mode:'public'|'code';
 created_at:string;
 updated_at:string;
}

/** Server-only canonical state. This record must never be exposed directly to clients. */
export interface RoomStateRecord {
 room_id:string;
 game_state:unknown|null;
 state_version:number;
 updated_at:string;
}

export interface RoomPlayerRecord {
 room_id:string;
 user_id:string;
 display_name:string;
 player_color:string|null;
 turn_order:number|null;
 is_ready:boolean;
 joined_at:string;
 last_seen_at:string;
}

export interface RoomAIPlayerRecord {id:string;room_id:string;bot_number:number;player_color:string;bot_strategy:BotStrategy;turn_order:number|null;created_at:string;updated_at:string}

export interface CreateRoomRequest {
 gameSlug:string;
 displayName:string;
}

export interface CreateRoomResult {
 room:{
  id:string;
  code:string;
  gameId:string;
  status:'lobby';
 };
}

export interface JoinRoomRequest {
 roomCode:string;
 displayName:string;
}

export interface JoinRoomResult {
 room:{
  id:string;
  code:string;
  gameId:string;
  status:'lobby';
 };
 joinedNew:boolean;
}

export interface JoinableRoom{roomCode:string;hostDisplayName:string;humanPlayers:number;aiPlayers:number;totalPlayers:number;maxPlayers:number;createdAt:string}
export interface ListJoinableRoomsRequest{gameSlug:string}
export interface ListJoinableRoomsResult{rooms:JoinableRoom[]}
export type JoinPublicRoomRequest=JoinRoomRequest;
export type JoinPublicRoomResult=JoinRoomResult;
export type ManageLobbyCommand={type:'setJoinMode';joinMode:'public'|'code'}|{type:'kickPlayer';targetUserId:string};
export interface ManageLobbyRequest{roomCode:string;command:ManageLobbyCommand}
export interface ManageLobbyResult{roomCode:string}
export interface RoomKickNotice{roomId:string;kickedAt:string}

export interface LeaveRoomRequest {roomCode:string}

export interface LeaveRoomResult {
 completed:true;
}

export interface SetPlayerColorRequest {roomCode:string;playerColor:string|null}
export interface SetPlayerColorResult {roomCode:string;playerColor:string|null;changed:boolean}

export interface SetPlayerReadyRequest {roomCode:string;isReady:boolean}
export interface SetPlayerReadyResult {roomCode:string;isReady:boolean;changed:boolean}

export interface StartGameRequest {roomCode:string}
export interface StartGameResult {roomCode:string;status:'active';stateVersion:number}

export interface ActiveGameStateRequest {roomCode:string}
export interface ActiveGameStateResult {roomCode:string;status:'active';stateVersion:number;viewerPlayerId:string;gameView:WorshipMePublicGameView}

export interface RoomGameVersionSignal {roomCode:string;stateVersion:number}
export type RoomGameSyncStatus='connecting'|'live'|'unavailable';
export interface RoomLobbyVersionSignal {roomCode:string;lobbyVersion:number}
export type RoomLobbySyncStatus=RoomGameSyncStatus;

export interface SubmitGameActionRequest {roomCode:string;expectedStateVersion:number;command:WorshipMeBrowserCommand}
export type SubmitGameActionResult=ActiveGameStateResult;

export type ManageAIPlayerCommand=
 |{type:'addAI'}
 |{type:'removeAI';aiPlayerId:string}
 |{type:'setAIColor';aiPlayerId:string;playerColor:string}
 |{type:'setAIStrategy';aiPlayerId:string;botStrategy:BotStrategy};
export interface ManageAIPlayerRequest{roomCode:string;command:ManageAIPlayerCommand}
export interface ManageAIPlayerResult{roomCode:string}
export interface AdvanceAIRequest{roomCode:string}
export type AdvanceAIResult=ActiveGameStateResult;
export interface GamePresenceRequest{roomCode:string}
export interface GamePresenceResult{completed:true}
