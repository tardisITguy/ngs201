export type {CreateRoomRequest,CreateRoomResult,GameRecord,JoinRoomRequest,JoinRoomResult,LeaveRoomRequest,LeaveRoomResult,RoomPlayerRecord,RoomRecord,RoomStateRecord,SetPlayerColorRequest,SetPlayerColorResult} from './types';
export {ensureAnonymousSession,PlatformAuthError,type AuthenticatedPlatformSession} from './auth/session';
export {createRoom,CreateRoomError} from './rooms/createRoom';
export {createJoinAction,joinRoom,JoinRoomError,normalizeRoomCode} from './rooms/joinRoom';
export {createLeaveAction,leaveRoom,LeaveRoomError} from './rooms/leaveRoom';
export {createSetPlayerColorAction,setPlayerColor,SetPlayerColorError} from './rooms/setPlayerColor';
export {getSupabaseClient} from './supabase/client';
export {listActiveGames,GamesCatalogError,type CatalogGame} from './games/catalog';
export {getLobby,LobbyReadError,type Lobby,type LobbyPlayer} from './rooms/lobby';
