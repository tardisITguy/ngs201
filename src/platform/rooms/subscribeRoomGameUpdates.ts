import type {RealtimeChannel,SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {RoomGameSyncStatus,RoomGameVersionSignal} from '../types';

export type {RoomGameSyncStatus,RoomGameVersionSignal} from '../types';
export interface RoomGameUpdateSubscription {roomCode:string;ready:Promise<RoomGameSyncStatus>;unsubscribe():Promise<void>}
export interface SubscribeRoomGameUpdatesOptions {
 roomCode:string;
 onSignal(signal:RoomGameVersionSignal):void;
 onStatus(status:RoomGameSyncStatus):void;
 connectionTimeoutMs?:number;
}

const signalFrom=(value:unknown,roomCode:string):RoomGameVersionSignal|undefined=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const row=value as Record<string,unknown>;
 if(row.room_code!==roomCode||!Number.isSafeInteger(row.state_version)||(row.state_version as number)<0)return;
 return{roomCode,stateVersion:row.state_version as number};
};

export async function subscribeRoomGameUpdates(options:SubscribeRoomGameUpdatesOptions,client:SupabaseClient=getSupabaseClient()):Promise<RoomGameUpdateSubscription>{
 const roomCode=normalizeRoomCode(options.roomCode);
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw Error('Invalid room code.');
 await ensureAnonymousSession(client);
 let active=true,settled=false,resolveReady!:(status:RoomGameSyncStatus)=>void;
 const ready=new Promise<RoomGameSyncStatus>(resolve=>{resolveReady=resolve;});
 const settle=(status:RoomGameSyncStatus)=>{if(settled)return;settled=true;globalThis.clearTimeout(timeout);resolveReady(status);};
 const timeout=globalThis.setTimeout(()=>settle('unavailable'),options.connectionTimeoutMs??4000);
 options.onStatus('connecting');
 const channel:RealtimeChannel=client.channel(`room-game-updates:${roomCode}`)
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'room_game_updates',filter:`room_code=eq.${roomCode}`},payload=>{if(!active)return;const signal=signalFrom(payload.new,roomCode);if(signal)options.onSignal(signal);})
  .subscribe(status=>{
   if(!active)return;
   if(status==='SUBSCRIBED'){options.onStatus('live');settle('live');return;}
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){options.onStatus('unavailable');settle('unavailable');}
  });
 return{roomCode,ready,async unsubscribe(){if(!active)return;active=false;globalThis.clearTimeout(timeout);settle('unavailable');await client.removeChannel(channel);}};
}
