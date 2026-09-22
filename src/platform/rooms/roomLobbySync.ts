import {getLobby,type Lobby} from './lobby';
import {normalizeRoomCode} from './joinRoom';
import {subscribeRoomLobbyUpdates,type RoomLobbySyncStatus,type RoomLobbyUpdateSubscription,type RoomLobbyVersionSignal,type SubscribeRoomLobbyUpdatesOptions} from './subscribeRoomLobbyUpdates';

export interface RoomLobbySyncCallbacks {
 onLobby(lobby:Lobby):void;
 onStatus(status:RoomLobbySyncStatus):void;
 onError(error:unknown):void;
}
export interface RoomLobbySyncDependencies {
 fetchLobby(roomCode:string):Promise<Lobby>;
 subscribe(options:SubscribeRoomLobbyUpdatesOptions):Promise<RoomLobbyUpdateSubscription>;
}
export interface RoomLobbySyncCoordinator {
 enter(roomCode:string):Promise<void>;
 leave():Promise<void>;
 refresh():Promise<Lobby|undefined>;
 noteSignal(signal:RoomLobbyVersionSignal):void;
 markInitialFetchComplete():void;
 isCurrent(roomCode:string):boolean;
 readonly highestSignaledVersion:number;
 readonly handledVersion:number;
 readonly status:RoomLobbySyncStatus;
}

export function createRoomLobbySyncCoordinator(callbacks:RoomLobbySyncCallbacks,dependencies:RoomLobbySyncDependencies={fetchLobby:getLobby,subscribe:subscribeRoomLobbyUpdates}):RoomLobbySyncCoordinator{
 let generation=0,currentRoom:string|undefined,subscription:RoomLobbyUpdateSubscription|undefined;
 let highestSignaledVersion=0,handledVersion=0,status:RoomLobbySyncStatus='unavailable',initialFetchComplete=false;
 let hadConnectionGap=false,recoveryCatchupPending=false;
 let refreshInFlight:Promise<Lobby|undefined>|undefined;

 const isCurrent=(roomCode:string)=>currentRoom===normalizeRoomCode(roomCode);
 const refresh=():Promise<Lobby|undefined>=>{
  if(!currentRoom)return Promise.resolve(undefined);
  if(refreshInFlight)return refreshInFlight;
  const roomCode=currentRoom,token=generation,targetVersion=highestSignaledVersion;
  let succeeded=false;
  const request=dependencies.fetchLobby(roomCode).then(lobby=>{
   if(token!==generation||currentRoom!==roomCode)return undefined;
   succeeded=true;handledVersion=Math.max(handledVersion,targetVersion);callbacks.onLobby(lobby);return lobby;
  }).catch(error=>{if(token===generation&&currentRoom===roomCode)callbacks.onError(error);return undefined;});
  refreshInFlight=request;
  void request.finally(()=>{
   if(refreshInFlight===request)refreshInFlight=undefined;
   if(succeeded&&token===generation&&currentRoom===roomCode&&highestSignaledVersion>handledVersion)void refresh();
  });
  return request;
 };
 const noteSignal=(signal:RoomLobbyVersionSignal)=>{
  if(!currentRoom||signal.roomCode!==currentRoom||!Number.isSafeInteger(signal.lobbyVersion)||signal.lobbyVersion<0)return;
  highestSignaledVersion=Math.max(highestSignaledVersion,signal.lobbyVersion);
  if(signal.lobbyVersion>handledVersion)void refresh();
 };
 const leave=async()=>{
  const old=subscription;generation++;currentRoom=undefined;subscription=undefined;refreshInFlight=undefined;highestSignaledVersion=0;handledVersion=0;initialFetchComplete=false;hadConnectionGap=false;recoveryCatchupPending=false;status='unavailable';
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
  }catch(error){if(token===generation&&currentRoom===roomCode){status='unavailable';hadConnectionGap=true;callbacks.onStatus(status);callbacks.onError(error);}}
 };
 return{enter,leave,refresh,noteSignal,markInitialFetchComplete(){initialFetchComplete=true;if(currentRoom&&status==='live'&&recoveryCatchupPending){recoveryCatchupPending=false;void refresh();}},isCurrent,get highestSignaledVersion(){return highestSignaledVersion;},get handledVersion(){return handledVersion;},get status(){return status;}};
}
