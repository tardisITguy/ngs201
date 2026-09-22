import type {ActiveGameStateRequest,ActiveGameStateResult} from '../types';
import {getActiveGameState} from './getActiveGameState';
import {normalizeRoomCode} from './joinRoom';
import {subscribeRoomGameUpdates,type RoomGameSyncStatus,type RoomGameUpdateSubscription,type RoomGameVersionSignal,type SubscribeRoomGameUpdatesOptions} from './subscribeRoomGameUpdates';

export interface RoomGameSyncCallbacks {
 onState(result:ActiveGameStateResult):void;
 onStatus(status:RoomGameSyncStatus):void;
 onError(error:unknown):void;
}
export interface RoomGameSyncDependencies {
 fetchState(request:ActiveGameStateRequest):Promise<ActiveGameStateResult|undefined>;
 subscribe(options:SubscribeRoomGameUpdatesOptions):Promise<RoomGameUpdateSubscription>;
}
export interface RoomGameSyncCoordinator {
 enter(roomCode:string):Promise<void>;
 leave():Promise<void>;
 refresh():Promise<ActiveGameStateResult|undefined>;
 acceptTrusted(result:ActiveGameStateResult):boolean;
 noteSignal(signal:RoomGameVersionSignal):void;
 markInitialFetchComplete():void;
 isCurrent(roomCode:string):boolean;
 readonly latestTrustedVersion:number;
 readonly status:RoomGameSyncStatus;
}

export function createRoomGameSyncCoordinator(callbacks:RoomGameSyncCallbacks,dependencies:RoomGameSyncDependencies={fetchState:getActiveGameState,subscribe:subscribeRoomGameUpdates}):RoomGameSyncCoordinator{
 let generation=0,currentRoom:string|undefined,subscription:RoomGameUpdateSubscription|undefined;
 let latestTrustedVersion=0,highestSignaledVersion=0,status:RoomGameSyncStatus='unavailable',initialFetchComplete=false;
 let hadConnectionGap=false,recoveryCatchupPending=false;
 let refreshInFlight:Promise<ActiveGameStateResult|undefined>|undefined;

 const isCurrent=(roomCode:string)=>currentRoom===normalizeRoomCode(roomCode);
 const acceptTrusted=(result:ActiveGameStateResult)=>{
  if(!currentRoom||result.roomCode!==currentRoom||!Number.isSafeInteger(result.stateVersion)||result.stateVersion<latestTrustedVersion)return false;
  highestSignaledVersion=Math.max(highestSignaledVersion,result.stateVersion);
  if(result.stateVersion===latestTrustedVersion)return false;
  latestTrustedVersion=result.stateVersion;callbacks.onState(result);return true;
 };
 const refresh=():Promise<ActiveGameStateResult|undefined>=>{
  if(!currentRoom)return Promise.resolve(undefined);
  if(refreshInFlight)return refreshInFlight;
  const roomCode=currentRoom,token=generation;
  let succeeded=false;
  const request=dependencies.fetchState({roomCode}).then(result=>{
   succeeded=true;
   if(token!==generation||currentRoom!==roomCode||!result)return undefined;
   acceptTrusted(result);return result;
  }).catch(error=>{if(token===generation&&currentRoom===roomCode)callbacks.onError(error);return undefined;});
  refreshInFlight=request;
  void request.finally(()=>{
   if(refreshInFlight===request)refreshInFlight=undefined;
   if(succeeded&&token===generation&&currentRoom===roomCode&&highestSignaledVersion>latestTrustedVersion)void refresh();
  });
  return request;
 };
 const noteSignal=(signal:RoomGameVersionSignal)=>{
  if(!currentRoom||signal.roomCode!==currentRoom||!Number.isSafeInteger(signal.stateVersion)||signal.stateVersion<0)return;
  highestSignaledVersion=Math.max(highestSignaledVersion,signal.stateVersion);
  if(signal.stateVersion>latestTrustedVersion)void refresh();
 };
 const leave=async()=>{
  const old=subscription;generation++;currentRoom=undefined;subscription=undefined;refreshInFlight=undefined;latestTrustedVersion=0;highestSignaledVersion=0;initialFetchComplete=false;hadConnectionGap=false;recoveryCatchupPending=false;status='unavailable';
  if(old)await old.unsubscribe();
 };
 const enter=async(roomCodeValue:string)=>{
  const roomCode=normalizeRoomCode(roomCodeValue);
  if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw Error('Invalid room code.');
  if(currentRoom===roomCode&&subscription){await subscription.ready;return;}
  await leave();
  const token=++generation;currentRoom=roomCode;status='connecting';callbacks.onStatus(status);
  try{
   const created=await dependencies.subscribe({roomCode,onSignal:signal=>{if(token===generation&&currentRoom===roomCode)noteSignal(signal);},onStatus:next=>{if(token!==generation||currentRoom!==roomCode)return;status=next;callbacks.onStatus(next);if(next==='unavailable'){hadConnectionGap=true;return;}if(next==='live'&&hadConnectionGap){hadConnectionGap=false;if(initialFetchComplete){recoveryCatchupPending=false;void refresh();}else recoveryCatchupPending=true;}}});
   if(token!==generation||currentRoom!==roomCode){await created.unsubscribe();return;}
   subscription=created;const readyStatus=await created.ready;
   if(token!==generation||currentRoom!==roomCode)return;
   if(readyStatus==='unavailable'&&status==='connecting'){status='unavailable';hadConnectionGap=true;callbacks.onStatus(status);}
  }catch(error){if(token===generation&&currentRoom===roomCode){status='unavailable';callbacks.onStatus(status);callbacks.onError(error);}}
 };
 return{enter,leave,refresh,acceptTrusted,noteSignal,markInitialFetchComplete(){initialFetchComplete=true;if(currentRoom&&status==='live'&&recoveryCatchupPending){recoveryCatchupPending=false;void refresh();}},isCurrent,get latestTrustedVersion(){return latestTrustedVersion;},get status(){return status;}};
}
