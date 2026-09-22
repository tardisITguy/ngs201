/** Generic NGSLLC platform records exposed to authenticated clients. */
import type {WorshipMePublicGameView} from '../games/worship-me/publicGameView';
import type {WorshipMeBrowserCommand} from '../games/worship-me/trustedGameCommand';
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

export interface SubmitGameActionRequest {roomCode:string;expectedStateVersion:number;command:WorshipMeBrowserCommand}
export type SubmitGameActionResult=ActiveGameStateResult;
