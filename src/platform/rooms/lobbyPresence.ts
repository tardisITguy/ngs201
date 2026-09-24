import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {LobbyPresenceRequest,LobbyPresenceResult} from '../types';

export class LobbyPresenceError extends Error{constructor(message='Unable to update lobby presence.'){super(message);this.name='LobbyPresenceError';}}

export async function touchLobbyPresence(request:LobbyPresenceRequest,client:SupabaseClient=getSupabaseClient()):Promise<LobbyPresenceResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new LobbyPresenceError('Invalid room code.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('lobby-presence',{body:{roomCode}});if(error||!data||typeof data!=='object'||(data as Record<string,unknown>).roomCode!==roomCode||(data as Record<string,unknown>).completed!==true)throw new LobbyPresenceError();return{roomCode,completed:true};
}

export function createTouchLobbyPresenceAction(command:(request:LobbyPresenceRequest)=>Promise<LobbyPresenceResult>=touchLobbyPresence){return(request:LobbyPresenceRequest)=>command(request);}
