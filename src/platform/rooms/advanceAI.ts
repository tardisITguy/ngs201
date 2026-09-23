import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {AdvanceAIRequest,AdvanceAIResult} from '../types';
import {normalizeRoomCode} from './joinRoom';

export class AdvanceAIError extends Error{constructor(message='AI turn could not advance.'){super(message);this.name='AdvanceAIError'}}
export async function advanceAI(request:AdvanceAIRequest,client:SupabaseClient=getSupabaseClient()):Promise<AdvanceAIResult>{const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new AdvanceAIError();await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('advance-ai',{body:{roomCode}});if(error||!data||typeof data!=='object'||(data as Record<string,unknown>).status!=='active')throw new AdvanceAIError();return data as AdvanceAIResult;}
export function createAdvanceAIAction(command:(request:AdvanceAIRequest)=>Promise<AdvanceAIResult>=advanceAI){let pending=false;return async(request:AdvanceAIRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
