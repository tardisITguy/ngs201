import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {CreateRoomRequest,CreateRoomResult} from '../types';

export class CreateRoomError extends Error {
 constructor(message:string,readonly cause?:unknown){super(message);this.name='CreateRoomError'}
}

function validatedRequest(request:CreateRoomRequest):CreateRoomRequest{
 const gameSlug=request.gameSlug;
 const displayName=request.displayName.trim();
 if(gameSlug.length<2||gameSlug.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameSlug))throw new CreateRoomError('Invalid game slug.');
 if(displayName.length<1||displayName.length>50)throw new CreateRoomError('Display name must be between 1 and 50 characters.');
 return{gameSlug,displayName};
}

function isResult(value:unknown):value is CreateRoomResult{
 if(!value||typeof value!=='object')return false;
 const room=(value as {room?:unknown}).room;
 return!!room&&typeof room==='object'
  &&typeof (room as Record<string,unknown>).id==='string'
  &&typeof (room as Record<string,unknown>).code==='string'
  &&typeof (room as Record<string,unknown>).gameId==='string'
  &&(room as Record<string,unknown>).status==='lobby';
}

export async function createRoom(request:CreateRoomRequest,client:SupabaseClient=getSupabaseClient()):Promise<CreateRoomResult>{
 const body=validatedRequest(request);
 await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('create-room',{body});
 if(error)throw new CreateRoomError('Unable to create room.',error);
 if(!isResult(data))throw new CreateRoomError('Create Room returned an invalid response.');
 return data;
}
