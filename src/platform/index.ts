export type {CreateRoomRequest,CreateRoomResult,GameRecord,JoinRoomRequest,JoinRoomResult,RoomPlayerRecord,RoomRecord,RoomStateRecord} from './types';
export {ensureAnonymousSession,PlatformAuthError,type AuthenticatedPlatformSession} from './auth/session';
export {createRoom,CreateRoomError} from './rooms/createRoom';
export {createJoinAction,joinRoom,JoinRoomError,normalizeRoomCode} from './rooms/joinRoom';
export {getSupabaseClient} from './supabase/client';
export {listActiveGames,GamesCatalogError,type CatalogGame} from './games/catalog';
export {getLobby,LobbyReadError,type Lobby,type LobbyPlayer} from './rooms/lobby';
