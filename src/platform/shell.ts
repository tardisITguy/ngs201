import {listActiveGames} from './games/catalog';
import {getDisplayName,saveIdentity,validateDisplayName} from './identity';
import {createRouter,type Route} from './router';
import {createHostAction} from './rooms/host';
import {createJoinAction,normalizeRoomCode} from './rooms/joinRoom';
import {createJoinPublicRoomAction,JoinPublicRoomError} from './rooms/joinPublicRoom';
import {listJoinableRooms,RoomDirectoryError} from './rooms/listJoinableRooms';
import {createLeaveAction} from './rooms/leaveRoom';
import {createReturnToLobbyAction,ReturnToLobbyError} from './rooms/returnToLobby';
import {createSetPlayerColorAction,SetPlayerColorError} from './rooms/setPlayerColor';
import {createSetPlayerReadyAction,SetPlayerReadyError} from './rooms/setPlayerReady';
import {createStartGameAction,StartGameError} from './rooms/startGame';
import {createGetActiveGameStateAction,ActiveGameStateError} from './rooms/getActiveGameState';
import {createSubmitGameAction,GameActionError} from './rooms/submitGameAction';
import {createManageAIPlayerAction,ManageAIPlayerError} from './rooms/manageAIPlayer';
import {createManageLobbyAction,ManageLobbyError} from './rooms/manageLobby';
import {createAdvanceAIAction,AdvanceAIError} from './rooms/advanceAI';
import {createTouchActiveGamePresenceAction} from './rooms/gamePresence';
import {createActiveGamePresenceCoordinator} from './rooms/activeGamePresence';
import {createTouchLobbyPresenceAction} from './rooms/lobbyPresence';
import {createActiveLobbyPresenceCoordinator} from './rooms/activeLobbyPresence';
import {createRoomGameSyncCoordinator} from './rooms/roomGameSync';
import {subscribeRoomGameUpdates} from './rooms/subscribeRoomGameUpdates';
import {createRoomLobbySyncCoordinator} from './rooms/roomLobbySync';
import {subscribeRoomLobbyUpdates} from './rooms/subscribeRoomLobbyUpdates';
import {createRoomKickSyncCoordinator} from './rooms/roomKickSync';
import {createActiveRoomLobbyLifecycle} from './rooms/activeRoomLobbyLifecycle';
import {describeBlessEdgeOption} from './rooms/blessEdgeOptionLabel';
import type {ActiveGameStateResult,RoomGameSyncStatus,RoomLobbySyncStatus} from './types';
import type {WorshipMeBrowserCommand} from '../games/worship-me/trustedGameCommand';
import {getLobby,type Lobby} from './rooms/lobby';
import {renderLobbyPlayerRows} from './rooms/lobbyPlayerRows';
import {renderBoard} from '../games/worship-me/ui/renderBoard';
import {defaultConfig} from '../games/worship-me/engine/config';
import {WORSHIP_ME_PLAYER_COLORS} from '../games/worship-me/ui/playerColors';
import './colorSelection.css';
import './activeGame.css';
import './activeGameActions.css';
import './lobbyDiscovery.css';

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const logo=()=>`<a class="brand" href="/" data-link aria-label="New Game Studios home"><img src="/brand/ngs/bannerlogo.png" alt="New Game Studios"><span>THE FUTURE IS NEW</span></a>`;
const header=(game=false)=>`<header class="shell-header">${logo()}${game?'<strong class="game-mark">WORSHIP ME!</strong>':''}</header>`;
const page=(content:string,game=false)=>`<div class="play-shell">${header(game)}<main class="shell-main">${content}</main></div>`;
const button=(label:string,attrs='')=>`<button class="primary-button" ${attrs}>${label}</button>`;

export function startPlayShell(root:HTMLDivElement){
 const host=createHostAction();
 const join=createJoinAction();
 const joinPublic=createJoinPublicRoomAction();
 const leave=createLeaveAction();
 const returnLobby=createReturnToLobbyAction();
 const setColor=createSetPlayerColorAction();
 const setReady=createSetPlayerReadyAction();
 const start=createStartGameAction();
 const getGameState=createGetActiveGameStateAction();
 const submitGame=createSubmitGameAction();
 const manageAI=createManageAIPlayerAction();
 const manageLobby=createManageLobbyAction();
 const advanceAI=createAdvanceAIAction();
 const touchGamePresence=createTouchActiveGamePresenceAction();
 const gamePresence=createActiveGamePresenceCoordinator({}, {touch:request=>touchGamePresence(request)});
 const touchLobbyPresence=createTouchLobbyPresenceAction();
 const lobbyPresence=createActiveLobbyPresenceCoordinator({}, {touch:request=>touchLobbyPresence(request)});
 let aiAdvanceInFlight=false,aiAttemptedRoom:string|undefined,aiAttemptedVersion=-1,aiAdvanceError='',aiAdvanceToken=0;
 let gameSyncStatus:RoomGameSyncStatus='unavailable',lobbySyncStatus:RoomLobbySyncStatus='unavailable',lastSyncError:unknown,lastLobbyError:unknown,pendingLobbyNotice='',pendingJoinNotice='';
 let activeLobbySnapshot:Lobby|undefined,activeLobbyMetadataUpdate:((lobby:Lobby)=>void)|undefined;
 const syncLabel=(status:RoomGameSyncStatus)=>status==='live'?'LIVE SYNC':status==='connecting'?'CONNECTING…':'LIVE SYNC UNAVAILABLE · USE REFRESH';
 const aggregateLobbySyncStatus=():RoomGameSyncStatus=>gameSyncStatus==='unavailable'||lobbySyncStatus==='unavailable'?'unavailable':gameSyncStatus==='connecting'||lobbySyncStatus==='connecting'?'connecting':'live';
 const updateSyncStatus=()=>{const lobbyStatus=aggregateLobbySyncStatus();root.querySelectorAll<HTMLElement>('[data-sync-status="lobby"]').forEach(element=>{element.textContent=syncLabel(lobbyStatus);element.dataset.syncState=lobbyStatus;});root.querySelectorAll<HTMLElement>('[data-sync-status="game"]').forEach(element=>{element.textContent=syncLabel(gameSyncStatus);element.dataset.syncState=gameSyncStatus;});};
 const roomLobbySync=createRoomLobbySyncCoordinator({
  onLobby:lobby=>handleLobbySnapshot(lobby,pendingLobbyNotice),
  onStatus:status=>{lobbySyncStatus=status;updateSyncStatus();},
  onError:error=>{lastLobbyError=error;const message=root.querySelector<HTMLElement>('.lobby [data-lobby-message]');if(message)message.textContent='Unable to refresh lobby.';},
 },{fetchLobby:code=>getLobby(code),subscribe:options=>subscribeRoomLobbyUpdates(options)});
 const roomSync=createRoomGameSyncCoordinator({
  onState:result=>renderActiveGameState(result.roomCode,result),
  onStatus:status=>{gameSyncStatus=status;updateSyncStatus();},
  onError:error=>{lastSyncError=error;const message=root.querySelector<HTMLElement>('.active-game [data-game-message]');if(message)message.textContent=error instanceof ActiveGameStateError?error.message:'Unable to refresh game.';},
 },{fetchState:request=>getGameState(request),subscribe:options=>subscribeRoomGameUpdates(options)});
 const activeRoomLifecycle=createActiveRoomLobbyLifecycle({
  onActiveMetadata:lobby=>{activeLobbySnapshot=lobby;activeLobbyMetadataUpdate?.(lobby);},
  onReturnedLobby:async lobby=>{gamePresence.leave();aiAdvanceToken++;aiAdvanceInFlight=false;aiAttemptedRoom=undefined;aiAttemptedVersion=-1;aiAdvanceError='';activeLobbyMetadataUpdate=undefined;activeLobbySnapshot=undefined;await roomSync.leave();if(!roomLobbySync.isCurrent(lobby.room.code))return;await roomSync.enter(lobby.room.code);if(!roomSync.isCurrent(lobby.room.code)||!roomLobbySync.isCurrent(lobby.room.code))return;roomSync.markInitialFetchComplete();activeRoomLifecycle.leave();renderLobbyState(lobby,pendingLobbyNotice);},
 });
 const roomKickSync=createRoomKickSyncCoordinator(()=>{pendingJoinNotice='You were removed from the room by the host.';lobbyPresence.leave();gamePresence.leave();aiAdvanceToken++;aiAdvanceInFlight=false;void Promise.all([roomKickSync.leave(),roomLobbySync.leave(),roomSync.leave()]).then(()=>router.navigate('/games/worship-me/join'));});
 let identityReturnPath:string|undefined;
 const router=createRouter(window,route=>void render(route));
 root.addEventListener('click',event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[data-link]');if(link){event.preventDefault();router.navigate(new URL(link.href).pathname);}});

 async function render(route:Route){
  if(route.name==='room'){
   lobbyPresence.leave();
   gamePresence.leave();
   activeRoomLifecycle.leave();activeLobbySnapshot=undefined;activeLobbyMetadataUpdate=undefined;
   if(aiAttemptedRoom&&aiAttemptedRoom!==normalizeRoomCode(route.code)){aiAdvanceToken++;aiAdvanceInFlight=false;aiAttemptedRoom=undefined;aiAttemptedVersion=-1;aiAdvanceError='';}
   root.innerHTML=page(`<section class="lobby"><div class="status-panel" role="status"><span class="spinner"></span> Connecting to room…</div></section>`,true);
   await Promise.all([roomSync.enter(route.code),roomLobbySync.enter(route.code)]);if(!roomSync.isCurrent(route.code)||!roomLobbySync.isCurrent(route.code))return;return renderLobby(route.code);
  }
  lobbyPresence.leave();gamePresence.leave();activeRoomLifecycle.leave();activeLobbySnapshot=undefined;activeLobbyMetadataUpdate=undefined;aiAdvanceToken++;aiAdvanceInFlight=false;aiAttemptedRoom=undefined;aiAttemptedVersion=-1;aiAdvanceError='';void Promise.all([roomKickSync.leave(),roomSync.leave(),roomLobbySync.leave()]);
  if(route.name==='identity')return renderIdentity();
  if(route.name==='games')return renderGames();
  if(route.name==='worship-me')return renderGameLanding();
  if(route.name==='worship-me-join'){
   if(!getDisplayName()){identityReturnPath='/games/worship-me/join';router.navigate('/');return;}
   return renderJoin();
  }
  root.innerHTML=page(`<section class="panel centered"><p class="eyebrow">404</p><h1>Page not found</h1><a class="text-link" href="/" data-link>Return home</a></section>`);
 }

 function renderIdentity(){
  const name=getDisplayName();
  root.innerHTML=page(`<section class="identity panel"><p class="eyebrow">WELCOME</p><h1>Ready to play?</h1><p class="lede">Choose the name other players will see.</p><form data-identity novalidate><label for="display-name">What should we call you?</label><input id="display-name" name="displayName" value="${escapeHtml(name)}" maxlength="50" autocomplete="nickname" autofocus><p class="form-message" data-message aria-live="polite"></p>${button('CONTINUE','type="submit"')}</form></section>`);
  const form=root.querySelector<HTMLFormElement>('[data-identity]')!,input=form.elements.namedItem('displayName') as HTMLInputElement,message=form.querySelector<HTMLElement>('[data-message]')!,submit=form.querySelector<HTMLButtonElement>('button')!;
  form.onsubmit=async event=>{event.preventDefault();const validation=validateDisplayName(input.value);if(validation){message.textContent=validation;input.focus();return;}submit.disabled=true;submit.textContent='STARTING SESSION…';message.textContent='';try{await saveIdentity(input.value);const destination=identityReturnPath??'/games';identityReturnPath=undefined;router.navigate(destination);}catch{message.textContent='We could not start your player session. Check your connection and try again.';submit.disabled=false;submit.textContent='CONTINUE';}};
 }

 async function renderGames(){
  root.innerHTML=page(`<section class="catalog"><div class="section-heading"><p class="eyebrow">NGS PLAY</p><h1>Games</h1><p>Pick a world. Bring your people.</p></div><div class="status-panel" role="status"><span class="spinner"></span> Loading games…</div></section>`);
  try{const games=await listActiveGames();if(!games.length){root.querySelector('.catalog')!.innerHTML+=`<div class="status-panel"><h2>No active games yet</h2><p>New worlds are being prepared.</p></div>`;root.querySelector('.status-panel[role]')?.remove();return;}const cards=games.map(game=>game.slug==='worship-me'?`<a class="game-card worship-card" href="/games/worship-me" data-link><div class="token-orbit" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><p class="eyebrow">STRATEGY · 2–8 PLAYERS</p><h2>${escapeHtml(game.name)}</h2><p>Rule the Faithful.</p><span class="card-action">VIEW GAME →</span></div></a>`:`<article class="game-card"><h2>${escapeHtml(game.name)}</h2></article>`).join('');root.querySelector('.status-panel')!.outerHTML=`<div class="game-grid">${cards}</div>`;}catch{root.querySelector('.status-panel')!.outerHTML=`<div class="status-panel error"><h2>Games couldn't load</h2><p>Check your connection, then try again.</p>${button('RETRY','data-retry')}</div>`;root.querySelector<HTMLButtonElement>('[data-retry]')!.onclick=()=>void renderGames();}
 }

 function renderGameLanding(){
  root.innerHTML=page(`<section class="game-hero"><a class="back-link" href="/games" data-link>← Back to Games</a><div class="worship-emblem" aria-hidden="true">W</div><p class="eyebrow">AN NGS ORIGINAL</p><h1>WORSHIP ME!</h1><p class="hero-tagline">Rule the Faithful.</p><p class="hero-copy">Build belief, command your followers, and outlast rival gods in a strategic struggle for devotion.</p><div class="hero-actions">${button('HOST GAME','data-host')}<a class="secondary-button text-link" href="/games/worship-me/join" data-link>JOIN GAME</a></div><p class="form-message" data-message aria-live="polite"></p></section>`,true);
  const hostButton=root.querySelector<HTMLButtonElement>('[data-host]')!,message=root.querySelector<HTMLElement>('[data-message]')!;
  hostButton.onclick=async()=>{const displayName=getDisplayName();if(!displayName){router.navigate('/');return;}hostButton.disabled=true;hostButton.textContent='CREATING ROOM…';message.textContent='';try{const result=await host(displayName);if(result)router.navigate(`/room/${encodeURIComponent(result.room.code)}`);}catch{message.textContent='We could not create the room. Please try again.';}finally{if(document.body.contains(hostButton)){hostButton.disabled=false;hostButton.textContent='HOST GAME';}}};
 }

 function renderJoin(){
  const joinNotice=pendingJoinNotice;pendingJoinNotice='';
  root.innerHTML=page(`<section class="join-page"><a class="back-link" href="/games/worship-me" data-link>← Back to Worship Me!</a><p class="eyebrow">NEW GAME STUDIOS</p><h1>JOIN A ROOM</h1><p class="lede">WORSHIP ME!</p>${joinNotice?`<p class="status-panel join-page__notice">${escapeHtml(joinNotice)}</p>`:''}<section class="panel room-directory"><div class="panel-title"><h2>AVAILABLE ROOMS</h2><button class="text-button" type="button" data-refresh-rooms>REFRESH</button></div><div data-room-directory><p>Loading rooms...</p></div><p class="form-message" data-directory-message aria-live="polite"></p></section><section class="panel join-by-code"><h2>JOIN BY CODE</h2><form data-join novalidate><label for="room-code">Room Code</label><input id="room-code" name="roomCode" minlength="6" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"><p class="form-message" data-message aria-live="polite"></p>${button('JOIN ROOM','type="submit"')}</form></section></section>`,true);
  const directory=root.querySelector<HTMLElement>('[data-room-directory]')!,directoryMessage=root.querySelector<HTMLElement>('[data-directory-message]')!,refreshRooms=root.querySelector<HTMLButtonElement>('[data-refresh-rooms]')!;
  const loadRooms=async()=>{refreshRooms.disabled=true;directory.innerHTML='<p>Loading rooms...</p>';directoryMessage.textContent='';try{const result=await listJoinableRooms({gameSlug:'worship-me'});if(!result.rooms.length)directory.innerHTML='<p>No public rooms are available.</p>';else{directory.innerHTML=result.rooms.map(room=>`<article class="room-directory__row"><div><strong>Host: ${escapeHtml(room.hostDisplayName)}</strong><span>Players: ${room.totalPlayers} / ${room.maxPlayers}</span><small>${room.humanPlayers} human · ${room.aiPlayers} AI</small></div><button class="primary-button compact" type="button" data-join-public="${escapeHtml(room.roomCode)}">JOIN</button></article>`).join('');directory.querySelectorAll<HTMLButtonElement>('[data-join-public]').forEach(control=>control.onclick=async()=>{const displayName=getDisplayName();if(!displayName){identityReturnPath='/games/worship-me/join';router.navigate('/');return;}control.disabled=true;control.textContent='JOINING...';directoryMessage.textContent='Joining room...';try{const joined=await joinPublic({roomCode:control.dataset.joinPublic!,displayName});if(joined)router.navigate(`/room/${encodeURIComponent(joined.room.code)}`);}catch(error){const failure=error instanceof JoinPublicRoomError?error.message:'Unable to join room.';await loadRooms();directoryMessage.textContent=failure;}});}}catch(error){directory.innerHTML='<p>Unable to load rooms. <button class="text-button" type="button" data-retry-rooms>RETRY</button></p>';directoryMessage.textContent=error instanceof RoomDirectoryError?error.message:'Unable to load rooms.';directory.querySelector<HTMLButtonElement>('[data-retry-rooms]')!.onclick=()=>void loadRooms();}finally{if(document.body.contains(refreshRooms))refreshRooms.disabled=false;}};
  refreshRooms.onclick=()=>void loadRooms();void loadRooms();
  const form=root.querySelector<HTMLFormElement>('[data-join]')!,input=form.elements.namedItem('roomCode') as HTMLInputElement,message=form.querySelector<HTMLElement>('[data-message]')!,submit=form.querySelector<HTMLButtonElement>('button')!;
  input.oninput=()=>{input.value=input.value.toUpperCase();};
  form.onsubmit=async event=>{
   event.preventDefault();
   const roomCode=normalizeRoomCode(input.value),displayName=getDisplayName();
   if(!displayName){identityReturnPath='/games/worship-me/join';router.navigate('/');return;}
   if(roomCode.length<6||roomCode.length>10||!/^[A-Z0-9]+$/.test(roomCode)){message.textContent='Enter a valid room code.';input.focus();return;}
   input.value=roomCode;submit.disabled=true;submit.textContent='JOINING ROOM…';message.textContent='Joining room...';
   try{const result=await join({roomCode,displayName});if(result)router.navigate(`/room/${encodeURIComponent(result.room.code)}`);}
   catch(error){message.textContent=error instanceof Error&&error.message==='You were removed from this room by the host.'?error.message:'We could not join that room. Check the code and try again.';}
   finally{if(document.body.contains(submit)){submit.disabled=false;submit.textContent='JOIN ROOM';}}
  };
 }

 async function renderLobby(code:string){
  if(!roomSync.isCurrent(code)||!roomLobbySync.isCurrent(code))return;
  root.innerHTML=page(`<section class="lobby"><div class="status-panel" role="status"><span class="spinner"></span> Loading room…</div></section>`,true);
  lastLobbyError=undefined;await roomLobbySync.refresh();roomLobbySync.markInitialFetchComplete();roomSync.markInitialFetchComplete();
  if(!roomSync.isCurrent(code)||!roomLobbySync.isCurrent(code))return;
  if(lastLobbyError&&!root.querySelector('.active-game')&&!root.querySelector('[data-lobby-message]')){const message=lastLobbyError instanceof Error?lastLobbyError.message:"You don't have access to this room.";root.querySelector('.lobby')!.innerHTML=`<section class="status-panel error"><h1>Room unavailable</h1><p>${escapeHtml(message)}</p><a class="text-link" href="/games" data-link>Back to Games</a></section>`;}
 }

 function handleLobbySnapshot(lobby:Lobby,lobbyNotice=''){
  if(activeRoomLifecycle.isCurrent(lobby.room.code)){activeRoomLifecycle.accept(lobby);return;}
  renderLobbyState(lobby,lobbyNotice);
 }

 function renderLobbyState(lobby:Lobby,lobbyNotice=''){
   if(!roomSync.isCurrent(lobby.room.code)||!roomLobbySync.isCurrent(lobby.room.code))return;
   if(lobby.room.status==='active'){
    lobbyPresence.leave();activeLobbySnapshot=lobby;void roomKickSync.leave();void renderActiveGame(lobby.room.code);return;
   }
   gamePresence.leave();activeRoomLifecycle.leave();activeLobbySnapshot=undefined;activeLobbyMetadataUpdate=undefined;
   if(roomSync.latestTrustedVersion>0)return;
   if(lobby.room.status!=='lobby'){lobbyPresence.leave();void Promise.all([roomKickSync.leave(),roomLobbySync.leave()]);root.querySelector('.lobby')!.innerHTML=`<section class="status-panel"><h1>Room unavailable</h1><p>This room is no longer an active lobby.</p><a class="text-link" href="/games" data-link>Back to Games</a></section>`;return;}
   lobbyPresence.enter(lobby.room.code);
   void roomKickSync.enter(lobby.room.id).catch(()=>{const message=root.querySelector<HTMLElement>('[data-lobby-message]');if(message)message.textContent='Kick notifications are unavailable. Refresh if the room changes.';});
   const humanPlayers=lobby.players.filter(player=>player.control==='human'),aiPlayers=lobby.players.filter(player=>player.control==='ai'),players=renderLobbyPlayerRows(lobby.players,lobby.room.isCurrentUserHost);
   const currentPlayer=humanPlayers.find(player=>player.isCurrentUser),canReady=WORSHIP_ME_PLAYER_COLORS.includes(currentPlayer?.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]),readyLabel=currentPlayer?.isReady?'NOT READY':'READY';
   const allColors=lobby.players.map(player=>player.playerColor),allReadyPreview=lobby.players.length>=defaultConfig.playerMin&&lobby.players.length<=defaultConfig.playerMax&&humanPlayers.every(player=>player.isReady&&WORSHIP_ME_PLAYER_COLORS.includes(player.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]))&&aiPlayers.every(player=>WORSHIP_ME_PLAYER_COLORS.includes(player.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number])&&['random','growth','templeRush','balanced'].includes(player.botStrategy))&&new Set(allColors).size===allColors.length;
   const hostHelp=lobby.room.isCurrentUserHost?'<p class="lobby-controls__help">If other players remain, host control passes to the longest-waiting player.</p>':'';
   const nameRoom=lobby.room.isCurrentUserHost?'<button class="secondary-button compact future-control" type="button" disabled aria-describedby="name-room-status">Name Room <small id="name-room-status">COMING NEXT</small></button>':'';
   const startGame=lobby.room.isCurrentUserHost?`<button class="primary-button compact" type="button" data-start ${allReadyPreview?'':'disabled'}>START GAME <small>${allReadyPreview?'':'WAITING FOR ALL PLAYERS'}</small></button>`:'';
   const readyHelp=!currentPlayer?.isReady&&!canReady?'<span class="ready-help" id="ready-help">Choose a color first</span>':'';
   const addAI=lobby.room.isCurrentUserHost&&lobby.players.length<lobby.room.maxPlayers?'<button class="text-button" type="button" data-add-ai>ADD AI</button>':'';
   const accessControl=lobby.room.isCurrentUserHost?`<label class="room-access-control"><span>ROOM ACCESS</span><select data-room-join-mode aria-label="Room access"><option value="public" ${lobby.room.joinMode==='public'?'selected':''}>PUBLIC</option><option value="code" ${lobby.room.joinMode==='code'?'selected':''}>CODE ONLY</option></select></label>`:`<span class="room-access-badge"><small>ROOM ACCESS</small>${lobby.room.joinMode==='public'?'PUBLIC':'CODE ONLY'}</span>`;
   const lobbyStatus=aggregateLobbySyncStatus();root.querySelector('.lobby')!.innerHTML=`<section class="lobby-controls" aria-labelledby="lobby-controls-heading"><div class="lobby-controls__heading"><h1 id="lobby-controls-heading">LOBBY CONTROLS</h1><span class="room-sync-status" data-sync-status="lobby" data-sync-state="${lobbyStatus}">${syncLabel(lobbyStatus)}</span></div><div class="lobby-controls__bar"><div class="lobby-controls__room"><span class="lobby-controls__label">ROOM</span><strong class="lobby-controls__code">${escapeHtml(lobby.room.code)}</strong><button class="secondary-button compact" type="button" data-copy>Copy Code</button>${accessControl}${nameRoom}</div><div class="lobby-controls__actions"><button class="secondary-button compact" type="button" data-leave>LEAVE LOBBY</button><span class="ready-control"><button class="secondary-button compact" type="button" data-ready ${!currentPlayer||(!currentPlayer.isReady&&!canReady)?'disabled':''} ${readyHelp?'aria-describedby="ready-help"':''}>${readyLabel}</button>${readyHelp}</span>${startGame}</div></div>${hostHelp}<div class="lobby-controls__messages"><p class="form-message" data-lobby-message aria-live="polite">${escapeHtml(lobbyNotice)}</p><p class="form-message" data-leave-message aria-live="polite"></p></div></section><section class="lobby-content-grid"><div class="panel players-panel"><div class="panel-title"><h2>PLAYERS</h2><div>${addAI}<button class="text-button" data-refresh>Refresh</button></div></div><ul class="player-list">${players}</ul></div><div class="panel chat-panel"><h2>CHAT</h2><div class="chat-panel__placeholder"><p>Chat will appear here in the next multiplayer step.</p><span class="coming">COMING NEXT</span></div></div></section>`;
   pendingLobbyNotice='';root.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{pendingLobbyNotice='';void roomLobbySync.refresh();};
   const copy=root.querySelector<HTMLButtonElement>('[data-copy]')!;
   copy.onclick=async()=>{try{await navigator.clipboard.writeText(lobby.room.code);copy.textContent='Copied!';}catch{copy.textContent='Copy unavailable';}};
   const leaveButton=root.querySelector<HTMLButtonElement>('[data-leave]')!,leaveMessage=root.querySelector<HTMLElement>('[data-leave-message]')!;
   leaveButton.onclick=async()=>{
    if(!window.confirm('Leave this lobby?'))return;
    lobbyPresence.leave();
    leaveButton.disabled=true;leaveButton.textContent='LEAVING LOBBY…';leaveMessage.textContent='Leaving lobby...';
    try{const result=await leave({roomCode:lobby.room.code});if(result){await roomKickSync.leave();router.navigate('/games/worship-me');}}
    catch{leaveMessage.textContent='We could not leave the lobby. Please try again.';if(roomLobbySync.isCurrent(lobby.room.code))lobbyPresence.enter(lobby.room.code);}
    finally{if(document.body.contains(leaveButton)){leaveButton.disabled=false;leaveButton.textContent='LEAVE LOBBY';}}
   };
   const lobbyMessage=root.querySelector<HTMLElement>('[data-lobby-message]')!,colorControl=root.querySelector<HTMLSelectElement>('[data-player-color-select]');
   const accessSelect=root.querySelector<HTMLSelectElement>('[data-room-join-mode]');if(accessSelect)accessSelect.onchange=async()=>{accessSelect.disabled=true;lobbyMessage.textContent='Updating room access...';try{await manageLobby({roomCode:lobby.room.code,command:{type:'setJoinMode',joinMode:accessSelect.value as 'public'|'code'}});pendingLobbyNotice='';await roomLobbySync.refresh();}catch(error){pendingLobbyNotice=error instanceof ManageLobbyError?error.message:'Unable to update room access.';await roomLobbySync.refresh();}};
   root.querySelectorAll<HTMLButtonElement>('[data-kick-player]').forEach(control=>control.onclick=async()=>{const target=humanPlayers.find(player=>player.userId===control.dataset.kickPlayer);if(!target||!window.confirm(`Remove ${target.displayName} from this room? They will not be able to rejoin this room.`))return;control.disabled=true;lobbyMessage.textContent=`Removing ${target.displayName}...`;try{await manageLobby({roomCode:lobby.room.code,command:{type:'kickPlayer',targetUserId:target.userId}});pendingLobbyNotice='';await roomLobbySync.refresh();}catch(error){pendingLobbyNotice=error instanceof ManageLobbyError?error.message:'Unable to remove player.';await roomLobbySync.refresh();}});
   if(colorControl)colorControl.onchange=async()=>{
    const playerColor=colorControl.value||null;colorControl.disabled=true;lobbyMessage.textContent='Updating color...';
    try{await setColor({roomCode:lobby.room.code,playerColor});pendingLobbyNotice='';await roomLobbySync.refresh();}
    catch(error){pendingLobbyNotice=error instanceof SetPlayerColorError?error.message:'Unable to update player color.';await roomLobbySync.refresh();}
   };
   const manage=async(command:Parameters<typeof manageAI>[0])=>{lobbyMessage.textContent='Updating AI player...';try{await manageAI(command);pendingLobbyNotice='';await roomLobbySync.refresh();}catch(error){pendingLobbyNotice=error instanceof ManageAIPlayerError?error.message:'Unable to update AI player.';await roomLobbySync.refresh();}};
   const addAIButton=root.querySelector<HTMLButtonElement>('[data-add-ai]');if(addAIButton)addAIButton.onclick=()=>{addAIButton.disabled=true;void manage({roomCode:lobby.room.code,command:{type:'addAI'}});};
   root.querySelectorAll<HTMLButtonElement>('[data-ai-remove]').forEach(control=>control.onclick=()=>{control.disabled=true;void manage({roomCode:lobby.room.code,command:{type:'removeAI',aiPlayerId:control.dataset.aiRemove!}});});
   root.querySelectorAll<HTMLSelectElement>('[data-ai-color]').forEach(control=>control.onchange=()=>{control.disabled=true;void manage({roomCode:lobby.room.code,command:{type:'setAIColor',aiPlayerId:control.dataset.aiColor!,playerColor:control.value}});});
   root.querySelectorAll<HTMLSelectElement>('[data-ai-strategy]').forEach(control=>control.onchange=()=>{control.disabled=true;void manage({roomCode:lobby.room.code,command:{type:'setAIStrategy',aiPlayerId:control.dataset.aiStrategy!,botStrategy:control.value as 'random'|'growth'|'templeRush'|'balanced'}});});
   const readyButton=root.querySelector<HTMLButtonElement>('[data-ready]');
   if(readyButton&&currentPlayer)readyButton.onclick=async()=>{
    readyButton.disabled=true;readyButton.textContent='UPDATING…';lobbyMessage.textContent='Updating Ready state...';
    try{await setReady({roomCode:lobby.room.code,isReady:!currentPlayer.isReady});pendingLobbyNotice='';await roomLobbySync.refresh();}
    catch(error){pendingLobbyNotice=error instanceof SetPlayerReadyError?error.message:'Unable to update Ready state.';await roomLobbySync.refresh();}
   };
   const startButton=root.querySelector<HTMLButtonElement>('[data-start]');
   if(startButton)startButton.onclick=async()=>{
    lobbyPresence.leave();
    startButton.disabled=true;startButton.textContent='STARTING GAME…';lobbyMessage.textContent='Starting game...';
    try{const started=await start({roomCode:lobby.room.code});if(started){await roomKickSync.leave();await roomSync.refresh();}}
    catch(error){pendingLobbyNotice=error instanceof StartGameError?error.message:'Unable to start game.';if(roomLobbySync.isCurrent(lobby.room.code))lobbyPresence.enter(lobby.room.code);await roomLobbySync.refresh();}
   };
 }

 async function renderActiveGame(code:string,showLoading=true){
  if(!roomSync.isCurrent(code))return;
  const holder=root.querySelector<HTMLElement>('.lobby');if(!holder)return;
  if(showLoading)holder.innerHTML=`<div class="status-panel" role="status"><span class="spinner"></span> Loading game…</div>`;
  lastSyncError=undefined;const result=await roomSync.refresh();if(result||!roomSync.isCurrent(code)||holder.querySelector('.active-game'))return;
  const message=lastSyncError instanceof ActiveGameStateError?lastSyncError.message:'Game state is unavailable';holder.innerHTML=`<section class="status-panel error"><h1>Game unavailable</h1><p>${escapeHtml(message)}</p><button class="primary-button" type="button" data-retry-game>TRY AGAIN</button></section>`;holder.querySelector<HTMLButtonElement>('[data-retry-game]')!.onclick=()=>void renderActiveGame(code);
 }

 function renderActiveGameState(code:string,result:ActiveGameStateResult){
   if(!roomSync.isCurrent(code)||result.stateVersion<roomSync.latestTrustedVersion)return;
   lobbyPresence.leave();void roomKickSync.leave();activeRoomLifecycle.enter(code);
   const holder=root.querySelector<HTMLElement>('.lobby');if(!holder)return;
   gamePresence.enter(code);
  type Mode='blessTile'|'smiteTile'|'blessEdge'|'smiteEdge';
   let mode:Mode|undefined,startCell:string|undefined,endCell:string|undefined,submitting=false,leavingGame=false,returningToLobby=false,notice=aiAdvanceError;
  const playerName=(id:string)=>result.gameView.players.find(player=>player.id===id)?.name??id;

  const scheduleAI=async(force=false)=>{
   const current=result.gameView.players.find(player=>player.id===result.gameView.currentPlayerId);
   if(current?.control!=='ai'||result.gameView.phase==='gameOver'||aiAdvanceInFlight||(!force&&aiAttemptedRoom===code&&aiAttemptedVersion===result.stateVersion))return;
   const token=++aiAdvanceToken;aiAdvanceInFlight=true;aiAttemptedRoom=code;aiAttemptedVersion=result.stateVersion;aiAdvanceError='';notice='AI THINKING…';paint();
   try{const next=await advanceAI({roomCode:code});if(next&&token===aiAdvanceToken&&roomSync.isCurrent(code)){aiAdvanceError='';roomSync.acceptTrusted(next);return;}}
   catch(error){if(roomSync.isCurrent(code)&&result.stateVersion>=roomSync.latestTrustedVersion)aiAdvanceError=error instanceof AdvanceAIError?error.message:'AI turn could not advance.';}
   finally{if(token===aiAdvanceToken)aiAdvanceInFlight=false;}
   if(roomSync.isCurrent(code)&&result.stateVersion>=roomSync.latestTrustedVersion){notice=aiAdvanceError;paint();}
  };

  const send=async(command:WorshipMeBrowserCommand)=>{
   if(submitting)return;submitting=true;notice='Submitting action…';paint();
   try{const next=await submitGame({roomCode:code,expectedStateVersion:result.stateVersion,command});if(next){roomSync.acceptTrusted(next);return;}}
   catch(error){notice=error instanceof GameActionError?error.message:'Unable to update game.';}
   finally{submitting=false;}
   if(!roomSync.isCurrent(code)||result.stateVersion<roomSync.latestTrustedVersion)return;
   mode=undefined;startCell=undefined;endCell=undefined;paint();
  };

   const isCurrentHost=()=>activeLobbySnapshot?.room.code===code&&activeLobbySnapshot.room.isCurrentUserHost;
   const gameOverControls=()=>`<section class="panel active-game__actions" data-game-over-actions><h2>GAME OVER</h2><p>${result.gameView.winnerId?`${escapeHtml(playerName(result.gameView.winnerId))} wins.`:'The game has ended.'}</p>${isCurrentHost()?`<button class="primary-button" type="button" data-return-to-lobby ${returningToLobby?'disabled':''}>${returningToLobby?'RETURNING TO LOBBY…':'RETURN TO LOBBY'}</button>`:'<p>Waiting for the host to return the room to the lobby.</p>'}</section>`;
   const bindReturnToLobby=()=>{const control=holder.querySelector<HTMLButtonElement>('[data-return-to-lobby]');if(control)control.onclick=async()=>{if(returningToLobby)return;returningToLobby=true;notice='Returning to lobby…';paint();try{const returned=await returnLobby({roomCode:code});if(returned){await roomLobbySync.refresh();return;}}catch(error){notice=error instanceof ReturnToLobbyError?error.message:'Unable to return to lobby.';}returningToLobby=false;if(roomSync.isCurrent(code))paint();};};
   const refreshGameOverAuthority=()=>{if(result.gameView.phase!=='gameOver')return;const panel=holder.querySelector<HTMLElement>('[data-game-over-actions]');if(!panel)return;panel.outerHTML=gameOverControls();bindReturnToLobby();};
   activeLobbyMetadataUpdate=lobby=>{activeLobbySnapshot=lobby;refreshGameOverAuthority();};

   const paint=()=>{
   const view=result.gameView,current=view.players.find(player=>player.id===view.currentPlayerId),viewer=view.players.find(player=>player.id===result.viewerPlayerId),direction=view.direction===1?'Clockwise':'Counterclockwise',pending=view.pendingDecision;
   const canPlace=view.phase==='placement'&&view.currentPlayerId===result.viewerPlayerId&&!pending;
   const canResolve=!!pending&&pending.playerId===result.viewerPlayerId;
   const players=view.players.map((player,index)=>`<li><strong>${index+1}. ${escapeHtml(player.name)}</strong><span>${escapeHtml(player.color)}</span>${player.control==='ai'?'<small class="active-game__badge">AI</small>':''}${player.id===view.currentPlayerId?'<small class="active-game__badge">CURRENT TURN</small>':''}${player.id===result.viewerPlayerId?'<small class="active-game__badge">YOU</small>':''}</li>`).join('');
   let controls='';
   if(canPlace){const edgeStarted=!!(mode&&(mode==='blessEdge'||mode==='smiteEdge')&&startCell),edgeConfirm=!!(edgeStarted&&endCell),modes:Array<{value:Mode;label:string}>=[{value:'blessTile',label:'BLESS TILE'},{value:'blessEdge',label:'BLESS EDGE'},{value:'smiteTile',label:'SMITE TILE'},{value:'smiteEdge',label:'SMITE EDGE'}];controls=`<section class="panel active-game__actions"><h2>GAME ACTIONS</h2><div class="active-game__action-buttons">${modes.map(item=>`<button type="button" class="secondary-button${mode===item.value?' selected':''}" data-game-mode="${item.value}" ${submitting?'disabled':''}>${item.label}</button>`).join('')}<button type="button" class="primary-button" data-end-turn ${submitting?'disabled':''}>END TURN</button></div>${mode?`<p>${mode.endsWith('Edge')?(startCell?endCell?`${escapeHtml(startCell)} → ${escapeHtml(endCell)}`:'Choose the second tile.':'Choose the first tile.'):'Choose a tile.'}</p>`:''}${edgeStarted?`<div class="active-game__confirm">${edgeConfirm?`<button type="button" class="primary-button" data-confirm-edge ${submitting?'disabled':''}>CONFIRM</button>`:''}<button type="button" class="secondary-button" data-cancel-action>CANCEL</button></div>`:''}</section>`;}
   else if(pending){if(canResolve&&pending.type==='blessEdgeMove')controls=`<section class="panel active-game__actions"><h2>RESOLVE BLESS EDGE</h2><div class="active-game__decision-list">${pending.options.map((option,index)=>`<button type="button" class="secondary-button" data-bless-option="${index}" ${submitting?'disabled':''}>${escapeHtml(describeBlessEdgeOption(option))}</button>`).join('')}</div></section>`;
    else if(canResolve&&pending.type==='smiteResource')controls=`<section class="panel active-game__actions"><h2>CHOOSE RESOURCE TO SMITE</h2><div class="active-game__action-buttons">${pending.options.map(resource=>`<button type="button" class="primary-button" data-smite-resource="${resource}" ${submitting?'disabled':''}>${resource.toUpperCase()}</button>`).join('')}</div></section>`;
    else controls=`<section class="panel active-game__actions"><p>Waiting for ${escapeHtml(playerName(pending.playerId))} to resolve ${pending.type==='blessEdgeMove'?'Bless Edge':'Smite'}.</p></section>`;}
   else if(view.phase!=='gameOver'){const ai=current?.control==='ai';controls=`<section class="panel active-game__actions"><p>${ai?(aiAdvanceInFlight?'AI THINKING…':aiAdvanceError||`Waiting for ${escapeHtml(playerName(view.currentPlayerId))} · AI.`):`Waiting for ${escapeHtml(playerName(view.currentPlayerId))}.`}</p>${ai&&aiAdvanceError?'<button class="secondary-button" type="button" data-retry-ai>RETRY AI</button>':''}</section>`;}
   else controls=gameOverControls();
   holder.innerHTML=`<section class="active-game"><div class="panel active-game__status"><div class="active-game__status-top"><div><p class="eyebrow">WORSHIP ME!</p><h1>ROOM ${escapeHtml(result.roomCode)}</h1><span class="active-game__version">STATE VERSION ${result.stateVersion}</span><span class="room-sync-status" data-sync-status="game" data-sync-state="${gameSyncStatus}">${syncLabel(gameSyncStatus)}</span></div><div class="active-game__status-actions"><button class="secondary-button compact" type="button" data-leave-game ${submitting||aiAdvanceInFlight||leavingGame||returningToLobby?'disabled':''}>${leavingGame?'LEAVING GAME…':'LEAVE GAME'}</button><button class="primary-button compact" type="button" data-refresh-game ${submitting||aiAdvanceInFlight||leavingGame||returningToLobby?'disabled':''}>REFRESH GAME</button></div></div><div class="active-game__turns"><p>Round ${view.round} · ${escapeHtml(view.phase)} · ${direction}</p><p>Current Turn: <strong>${escapeHtml(current?.name??view.currentPlayerId)} · ${escapeHtml(current?.color??'Unknown')}${current?.control==='ai'?' · AI':''}</strong></p><p>You: <strong>${escapeHtml(viewer?.name??result.viewerPlayerId)} · ${escapeHtml(viewer?.color??'Unknown')}</strong></p></div><p class="form-message" data-game-message aria-live="polite">${escapeHtml(notice)}</p></div>${controls}<div class="active-game__board-scroll"><div class="multiplayer-board">${renderBoard(view,{start:startCell,end:endCell},{interactive:canPlace})}</div></div><section class="panel active-game__players"><h2>PLAYERS</h2><ol>${players}</ol></section><p class="active-game__readonly">TRUSTED MULTIPLAYER · REALTIME VERSION SIGNALS</p></section>`;
   const refresh=holder.querySelector<HTMLButtonElement>('[data-refresh-game]')!;refresh.onclick=async()=>{if(submitting||returningToLobby)return;refresh.disabled=true;refresh.textContent='REFRESHING…';lastSyncError=undefined;await roomSync.refresh();if(document.body.contains(refresh)){refresh.disabled=false;refresh.textContent='REFRESH GAME';}};
   const leaveGame=holder.querySelector<HTMLButtonElement>('[data-leave-game]')!;leaveGame.onclick=async()=>{if(leavingGame||returningToLobby||!window.confirm('Leave this game? AI will take over your player for the rest of the game.'))return;leavingGame=true;notice='Leaving game…';gamePresence.leave();paint();try{const left=await leave({roomCode:code});if(left){activeRoomLifecycle.leave();activeLobbySnapshot=undefined;activeLobbyMetadataUpdate=undefined;aiAdvanceToken++;aiAdvanceInFlight=false;await Promise.all([roomSync.leave(),roomLobbySync.leave()]);router.navigate('/games/worship-me');return;}}catch{notice='We could not leave the game. Please try again.';}leavingGame=false;if(roomSync.isCurrent(code)){gamePresence.enter(code);paint();}};
   bindReturnToLobby();
   holder.querySelectorAll<HTMLButtonElement>('[data-game-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.gameMode as Mode;startCell=undefined;endCell=undefined;notice='';paint();});
   holder.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(cell=>cell.onclick=()=>{if(!canPlace||submitting)return;if(!mode){notice='Choose an action first.';paint();return;}const id=cell.dataset.cell!;if(mode==='blessTile'||mode==='smiteTile'){void send({type:'placeTile',kind:mode==='blessTile'?'bless':'smite',cellId:id});return;}if(!startCell){startCell=id;notice='';paint();return;}if(!endCell&&id!==startCell){endCell=id;notice='Confirm the selected edge.';paint();}});
   const end=holder.querySelector<HTMLButtonElement>('[data-end-turn]');if(end)end.onclick=()=>void send({type:'endTurn'});
   const confirm=holder.querySelector<HTMLButtonElement>('[data-confirm-edge]');if(confirm)confirm.onclick=()=>{if(!mode||!startCell||!endCell)return;void send(mode==='blessEdge'?{type:'placeEdge',kind:'bless',from:startCell,to:endCell}:{type:'placeEdge',kind:'smite',a:startCell,b:endCell});};
   const cancel=holder.querySelector<HTMLButtonElement>('[data-cancel-action]');if(cancel)cancel.onclick=()=>{mode=undefined;startCell=undefined;endCell=undefined;notice='';paint();};
   holder.querySelectorAll<HTMLButtonElement>('[data-bless-option]').forEach(button=>button.onclick=()=>void send({type:'resolveBlessEdge',optionIndex:Number(button.dataset.blessOption)}));
   holder.querySelectorAll<HTMLButtonElement>('[data-smite-resource]').forEach(button=>button.onclick=()=>void send({type:'resolveSmiteResource',resource:button.dataset.smiteResource as 'wheat'|'bread'}));
   const retryAI=holder.querySelector<HTMLButtonElement>('[data-retry-ai]');if(retryAI)retryAI.onclick=()=>{aiAdvanceError='';aiAttemptedVersion=-1;void scheduleAI(true);};
   if(current?.control==='ai'&&!aiAdvanceError)queueMicrotask(()=>void scheduleAI());
  };
  paint();
 }
 router.start();
}
