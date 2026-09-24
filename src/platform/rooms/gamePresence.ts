import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {GamePresenceRequest,GamePresenceResult} from '../types';

export class GamePresenceError extends Error{constructor(message='Unable to update game presence.'){super(message);this.name='GamePresenceError'}}

export async function touchActiveGamePresence(request:GamePresenceRequest,client:SupabaseClient=getSupabaseClient()):Promise<GamePresenceResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new GamePresenceError('Invalid room code.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('game-presence',{body:{roomCode}});if(error||!data||typeof data!=='object'||(data as Record<string,unknown>).completed!==true)throw new GamePresenceError();return{completed:true};
}

export function createTouchActiveGamePresenceAction(command:(request:GamePresenceRequest)=>Promise<GamePresenceResult>=touchActiveGamePresence){let pending=false;return async(request:GamePresenceRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
