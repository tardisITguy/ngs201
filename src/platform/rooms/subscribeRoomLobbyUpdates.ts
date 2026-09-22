import type {RealtimeChannel,SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {RoomLobbySyncStatus,RoomLobbyVersionSignal} from '../types';

export type {RoomLobbySyncStatus,RoomLobbyVersionSignal} from '../types';
export interface RoomLobbyUpdateSubscription {roomCode:string;ready:Promise<RoomLobbySyncStatus>;unsubscribe():Promise<void>}
export interface SubscribeRoomLobbyUpdatesOptions {
 roomCode:string;
 onSignal(signal:RoomLobbyVersionSignal):void;
 onStatus(status:RoomLobbySyncStatus):void;
 connectionTimeoutMs?:number;
}

const signalFrom=(value:unknown,roomCode:string):RoomLobbyVersionSignal|undefined=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const row=value as Record<string,unknown>;
 if(row.room_code!==roomCode||!Number.isSafeInteger(row.lobby_version)||(row.lobby_version as number)<0)return;
 return{roomCode,lobbyVersion:row.lobby_version as number};
};

export async function subscribeRoomLobbyUpdates(options:SubscribeRoomLobbyUpdatesOptions,client:SupabaseClient=getSupabaseClient()):Promise<RoomLobbyUpdateSubscription>{
 const roomCode=normalizeRoomCode(options.roomCode);
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw Error('Invalid room code.');
 await ensureAnonymousSession(client);
 let active=true,settled=false,resolveReady!:(status:RoomLobbySyncStatus)=>void;
 const ready=new Promise<RoomLobbySyncStatus>(resolve=>{resolveReady=resolve;});
 const settle=(status:RoomLobbySyncStatus)=>{if(settled)return;settled=true;globalThis.clearTimeout(timeout);resolveReady(status);};
 const timeout=globalThis.setTimeout(()=>settle('unavailable'),options.connectionTimeoutMs??4000);
 options.onStatus('connecting');
 const channel:RealtimeChannel=client.channel(`room-lobby-updates:${roomCode}`)
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_lobby_updates',filter:`room_code=eq.${roomCode}`},payload=>{if(!active)return;const signal=signalFrom(payload.new,roomCode);if(signal)options.onSignal(signal);})
  .subscribe(status=>{
   if(!active)return;
   if(status==='SUBSCRIBED'){options.onStatus('live');settle('live');return;}
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){options.onStatus('unavailable');settle('unavailable');}
  });
 return{roomCode,ready,async unsubscribe(){if(!active)return;active=false;globalThis.clearTimeout(timeout);settle('unavailable');await client.removeChannel(channel);}};
}
