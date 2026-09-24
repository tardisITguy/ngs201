import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {JoinableRoom,ListJoinableRoomsRequest,ListJoinableRoomsResult} from '../types';

export class RoomDirectoryError extends Error{constructor(message='Unable to load rooms.'){super(message);this.name='RoomDirectoryError'}}
const isCount=(value:unknown)=>Number.isInteger(value)&&(value as number)>=0;
const isRoom=(value:unknown):value is JoinableRoom=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const room=value as Record<string,unknown>;return typeof room.roomCode==='string'&&typeof room.hostDisplayName==='string'&&isCount(room.humanPlayers)&&isCount(room.aiPlayers)&&isCount(room.totalPlayers)&&isCount(room.maxPlayers)&&typeof room.createdAt==='string'&&Object.keys(room).sort().join(',')==='aiPlayers,createdAt,hostDisplayName,humanPlayers,maxPlayers,roomCode,totalPlayers';};
export async function listJoinableRooms(request:ListJoinableRoomsRequest,client:SupabaseClient=getSupabaseClient()):Promise<ListJoinableRoomsResult>{const gameSlug=request.gameSlug.trim();if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameSlug)||gameSlug.length<2||gameSlug.length>64)throw new RoomDirectoryError('Invalid room directory request.');await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('list-rooms',{body:{gameSlug}});if(error||!data||typeof data!=='object'||!Array.isArray((data as Record<string,unknown>).rooms)||(data as {rooms:unknown[]}).rooms.some(room=>!isRoom(room)))throw new RoomDirectoryError();return data as ListJoinableRoomsResult;}
