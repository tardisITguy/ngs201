import {listActiveGames} from './games/catalog';
import {getDisplayName,saveIdentity,validateDisplayName} from './identity';
import {createRouter,type Route} from './router';
import {createHostAction} from './rooms/host';
import {createJoinAction,normalizeRoomCode} from './rooms/joinRoom';
import {createLeaveAction} from './rooms/leaveRoom';
import {createSetPlayerColorAction,SetPlayerColorError} from './rooms/setPlayerColor';
import {createSetPlayerReadyAction,SetPlayerReadyError} from './rooms/setPlayerReady';
import {createStartGameAction,StartGameError} from './rooms/startGame';
import {createGetActiveGameStateAction,ActiveGameStateError} from './rooms/getActiveGameState';
import {createSubmitGameAction,GameActionError} from './rooms/submitGameAction';
import {createRoomGameSyncCoordinator} from './rooms/roomGameSync';
import {subscribeRoomGameUpdates} from './rooms/subscribeRoomGameUpdates';
import {createRoomLobbySyncCoordinator} from './rooms/roomLobbySync';
import {subscribeRoomLobbyUpdates} from './rooms/subscribeRoomLobbyUpdates';
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

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const logo=()=>`<a class="brand" href="/" data-link aria-label="New Game Studios home"><img src="/brand/ngs/bannerlogo.png" alt="New Game Studios"><span>THE FUTURE IS NEW</span></a>`;
const header=(game=false)=>`<header class="shell-header">${logo()}${game?'<strong class="game-mark">WORSHIP ME!</strong>':''}</header>`;
const page=(content:string,game=false)=>`<div class="play-shell">${header(game)}<main class="shell-main">${content}</main></div>`;
const button=(label:string,attrs='')=>`<button class="primary-button" ${attrs}>${label}</button>`;

export function startPlayShell(root:HTMLDivElement){
 const host=createHostAction();
 const join=createJoinAction();
 const leave=createLeaveAction();
 const setColor=createSetPlayerColorAction();
 const setReady=createSetPlayerReadyAction();
 const start=createStartGameAction();
 const getGameState=createGetActiveGameStateAction();
 const submitGame=createSubmitGameAction();
 let gameSyncStatus:RoomGameSyncStatus='unavailable',lobbySyncStatus:RoomLobbySyncStatus='unavailable',lastSyncError:unknown,lastLobbyError:unknown,pendingLobbyNotice='';
 const syncLabel=(status:RoomGameSyncStatus)=>status==='live'?'LIVE SYNC':status==='connecting'?'CONNECTING…':'LIVE SYNC UNAVAILABLE · USE REFRESH';
 const aggregateLobbySyncStatus=():RoomGameSyncStatus=>gameSyncStatus==='unavailable'||lobbySyncStatus==='unavailable'?'unavailable':gameSyncStatus==='connecting'||lobbySyncStatus==='connecting'?'connecting':'live';
 const updateSyncStatus=()=>{const lobbyStatus=aggregateLobbySyncStatus();root.querySelectorAll<HTMLElement>('[data-sync-status="lobby"]').forEach(element=>{element.textContent=syncLabel(lobbyStatus);element.dataset.syncState=lobbyStatus;});root.querySelectorAll<HTMLElement>('[data-sync-status="game"]').forEach(element=>{element.textContent=syncLabel(gameSyncStatus);element.dataset.syncState=gameSyncStatus;});};
 const roomLobbySync=createRoomLobbySyncCoordinator({
  onLobby:lobby=>renderLobbyState(lobby,pendingLobbyNotice),
  onStatus:status=>{lobbySyncStatus=status;updateSyncStatus();},
  onError:error=>{lastLobbyError=error;const message=root.querySelector<HTMLElement>('.lobby [data-lobby-message]');if(message)message.textContent='Unable to refresh lobby.';},
 },{fetchLobby:code=>getLobby(code),subscribe:options=>subscribeRoomLobbyUpdates(options)});
 const roomSync=createRoomGameSyncCoordinator({
  onState:result=>{void roomLobbySync.leave();renderActiveGameState(result.roomCode,result);},
  onStatus:status=>{gameSyncStatus=status;updateSyncStatus();},
  onError:error=>{lastSyncError=error;const message=root.querySelector<HTMLElement>('.active-game [data-game-message]');if(message)message.textContent=error instanceof ActiveGameStateError?error.message:'Unable to refresh game.';},
 },{fetchState:request=>getGameState(request),subscribe:options=>subscribeRoomGameUpdates(options)});
 let identityReturnPath:string|undefined;
 const router=createRouter(window,route=>void render(route));
 root.addEventListener('click',event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[data-link]');if(link){event.preventDefault();router.navigate(new URL(link.href).pathname);}});

 async function render(route:Route){
  if(route.name==='room'){
   root.innerHTML=page(`<section class="lobby"><div class="status-panel" role="status"><span class="spinner"></span> Connecting to room…</div></section>`,true);
   await Promise.all([roomSync.enter(route.code),roomLobbySync.enter(route.code)]);if(!roomSync.isCurrent(route.code)||!roomLobbySync.isCurrent(route.code))return;return renderLobby(route.code);
  }
  void Promise.all([roomSync.leave(),roomLobbySync.leave()]);
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
  root.innerHTML=page(`<section class="identity panel"><a class="back-link" href="/games/worship-me" data-link>← Back to Worship Me!</a><p class="eyebrow">NEW GAME STUDIOS</p><h1>JOIN A ROOM</h1><p class="lede">WORSHIP ME!</p><form data-join novalidate><label for="room-code">Room Code</label><input id="room-code" name="roomCode" minlength="6" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" autofocus><p class="form-message" data-message aria-live="polite"></p>${button('JOIN ROOM','type="submit"')}</form></section>`,true);
  const form=root.querySelector<HTMLFormElement>('[data-join]')!,input=form.elements.namedItem('roomCode') as HTMLInputElement,message=form.querySelector<HTMLElement>('[data-message]')!,submit=form.querySelector<HTMLButtonElement>('button')!;
  input.oninput=()=>{input.value=input.value.toUpperCase();};
  form.onsubmit=async event=>{
   event.preventDefault();
   const roomCode=normalizeRoomCode(input.value),displayName=getDisplayName();
   if(!displayName){identityReturnPath='/games/worship-me/join';router.navigate('/');return;}
   if(roomCode.length<6||roomCode.length>10||!/^[A-Z0-9]+$/.test(roomCode)){message.textContent='Enter a valid room code.';input.focus();return;}
   input.value=roomCode;submit.disabled=true;submit.textContent='JOINING ROOM…';message.textContent='Joining room...';
   try{const result=await join({roomCode,displayName});if(result)router.navigate(`/room/${encodeURIComponent(result.room.code)}`);}
   catch{message.textContent='We could not join that room. Check the code and try again.';}
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

 function renderLobbyState(lobby:Lobby,lobbyNotice=''){
   if(!roomSync.isCurrent(lobby.room.code)||!roomLobbySync.isCurrent(lobby.room.code))return;
   if(roomSync.latestTrustedVersion>0)return;
   if(lobby.room.status==='active'){
    void roomLobbySync.leave();void renderActiveGame(lobby.room.code);return;
   }
   if(lobby.room.status!=='lobby'){void roomLobbySync.leave();root.querySelector('.lobby')!.innerHTML=`<section class="status-panel"><h1>Room unavailable</h1><p>This room is no longer an active lobby.</p><a class="text-link" href="/games" data-link>Back to Games</a></section>`;return;}
   const players=renderLobbyPlayerRows(lobby.players);
   const currentPlayer=lobby.players.find(player=>player.isCurrentUser),canReady=WORSHIP_ME_PLAYER_COLORS.includes(currentPlayer?.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]),readyLabel=currentPlayer?.isReady?'NOT READY':'READY';
   const allReadyPreview=lobby.players.length>=defaultConfig.playerMin&&lobby.players.every(player=>player.isReady&&WORSHIP_ME_PLAYER_COLORS.includes(player.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]));
   const hostHelp=lobby.room.isCurrentUserHost?'<p class="lobby-controls__help">If other players remain, host control passes to the longest-waiting player.</p>':'';
   const nameRoom=lobby.room.isCurrentUserHost?'<button class="secondary-button compact future-control" type="button" disabled aria-describedby="name-room-status">Name Room <small id="name-room-status">COMING NEXT</small></button>':'';
   const startGame=lobby.room.isCurrentUserHost?`<button class="primary-button compact" type="button" data-start ${allReadyPreview?'':'disabled'}>START GAME <small>${allReadyPreview?'':'WAITING FOR ALL PLAYERS'}</small></button>`:'';
   const readyHelp=!currentPlayer?.isReady&&!canReady?'<span class="ready-help" id="ready-help">Choose a color first</span>':'';
   const lobbyStatus=aggregateLobbySyncStatus();root.querySelector('.lobby')!.innerHTML=`<section class="lobby-controls" aria-labelledby="lobby-controls-heading"><div class="lobby-controls__heading"><h1 id="lobby-controls-heading">LOBBY CONTROLS</h1><span class="room-sync-status" data-sync-status="lobby" data-sync-state="${lobbyStatus}">${syncLabel(lobbyStatus)}</span></div><div class="lobby-controls__bar"><div class="lobby-controls__room"><span class="lobby-controls__label">ROOM</span><strong class="lobby-controls__code">${escapeHtml(lobby.room.code)}</strong><button class="secondary-button compact" type="button" data-copy>Copy Code</button>${nameRoom}</div><div class="lobby-controls__actions"><button class="secondary-button compact" type="button" data-leave>LEAVE LOBBY</button><span class="ready-control"><button class="secondary-button compact" type="button" data-ready ${!currentPlayer||(!currentPlayer.isReady&&!canReady)?'disabled':''} ${readyHelp?'aria-describedby="ready-help"':''}>${readyLabel}</button>${readyHelp}</span>${startGame}</div></div>${hostHelp}<div class="lobby-controls__messages"><p class="form-message" data-lobby-message aria-live="polite">${escapeHtml(lobbyNotice)}</p><p class="form-message" data-leave-message aria-live="polite"></p></div></section><section class="lobby-content-grid"><div class="panel players-panel"><div class="panel-title"><h2>PLAYERS</h2><button class="text-button" data-refresh>Refresh</button></div><ul class="player-list">${players||'<li>No players found.</li>'}</ul></div><div class="panel chat-panel"><h2>CHAT</h2><div class="chat-panel__placeholder"><p>Chat will appear here in the next multiplayer step.</p><span class="coming">COMING NEXT</span></div></div></section>`;
   pendingLobbyNotice='';root.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{pendingLobbyNotice='';void roomLobbySync.refresh();};
   const copy=root.querySelector<HTMLButtonElement>('[data-copy]')!;
   copy.onclick=async()=>{try{await navigator.clipboard.writeText(lobby.room.code);copy.textContent='Copied!';}catch{copy.textContent='Copy unavailable';}};
   const leaveButton=root.querySelector<HTMLButtonElement>('[data-leave]')!,leaveMessage=root.querySelector<HTMLElement>('[data-leave-message]')!;
   leaveButton.onclick=async()=>{
    if(!window.confirm('Leave this lobby?'))return;
    leaveButton.disabled=true;leaveButton.textContent='LEAVING LOBBY…';leaveMessage.textContent='Leaving lobby...';
    try{const result=await leave({roomCode:lobby.room.code});if(result)router.navigate('/games/worship-me');}
    catch{leaveMessage.textContent='We could not leave the lobby. Please try again.';}
    finally{if(document.body.contains(leaveButton)){leaveButton.disabled=false;leaveButton.textContent='LEAVE LOBBY';}}
   };
   const lobbyMessage=root.querySelector<HTMLElement>('[data-lobby-message]')!,colorControl=root.querySelector<HTMLSelectElement>('[data-player-color-select]');
   if(colorControl)colorControl.onchange=async()=>{
    const playerColor=colorControl.value||null;colorControl.disabled=true;lobbyMessage.textContent='Updating color...';
    try{await setColor({roomCode:lobby.room.code,playerColor});pendingLobbyNotice='';await roomLobbySync.refresh();}
    catch(error){pendingLobbyNotice=error instanceof SetPlayerColorError?error.message:'Unable to update player color.';await roomLobbySync.refresh();}
   };
   const readyButton=root.querySelector<HTMLButtonElement>('[data-ready]');
   if(readyButton&&currentPlayer)readyButton.onclick=async()=>{
    readyButton.disabled=true;readyButton.textContent='UPDATING…';lobbyMessage.textContent='Updating Ready state...';
    try{await setReady({roomCode:lobby.room.code,isReady:!currentPlayer.isReady});pendingLobbyNotice='';await roomLobbySync.refresh();}
    catch(error){pendingLobbyNotice=error instanceof SetPlayerReadyError?error.message:'Unable to update Ready state.';await roomLobbySync.refresh();}
   };
   const startButton=root.querySelector<HTMLButtonElement>('[data-start]');
   if(startButton)startButton.onclick=async()=>{
    startButton.disabled=true;startButton.textContent='STARTING GAME…';lobbyMessage.textContent='Starting game...';
    try{const started=await start({roomCode:lobby.room.code});if(started)await roomSync.refresh();}
    catch(error){pendingLobbyNotice=error instanceof StartGameError?error.message:'Unable to start game.';await roomLobbySync.refresh();}
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
  void roomLobbySync.leave();
  const holder=root.querySelector<HTMLElement>('.lobby');if(!holder)return;
  type Mode='blessTile'|'smiteTile'|'blessEdge'|'smiteEdge';
  let mode:Mode|undefined,startCell:string|undefined,endCell:string|undefined,submitting=false,notice='';
  const playerName=(id:string)=>result.gameView.players.find(player=>player.id===id)?.name??id;

  const send=async(command:WorshipMeBrowserCommand)=>{
   if(submitting)return;submitting=true;notice='Submitting action…';paint();
   try{const next=await submitGame({roomCode:code,expectedStateVersion:result.stateVersion,command});if(next){roomSync.acceptTrusted(next);return;}}
   catch(error){notice=error instanceof GameActionError?error.message:'Unable to update game.';}
   finally{submitting=false;}
   if(!roomSync.isCurrent(code)||result.stateVersion<roomSync.latestTrustedVersion)return;
   mode=undefined;startCell=undefined;endCell=undefined;paint();
  };

  const paint=()=>{
   const view=result.gameView,current=view.players.find(player=>player.id===view.currentPlayerId),viewer=view.players.find(player=>player.id===result.viewerPlayerId),direction=view.direction===1?'Clockwise':'Counterclockwise',pending=view.pendingDecision;
   const canPlace=view.phase==='placement'&&view.currentPlayerId===result.viewerPlayerId&&!pending;
   const canResolve=!!pending&&pending.playerId===result.viewerPlayerId;
   const players=view.players.map((player,index)=>`<li><strong>${index+1}. ${escapeHtml(player.name)}</strong><span>${escapeHtml(player.color)}</span>${player.id===view.currentPlayerId?'<small class="active-game__badge">CURRENT TURN</small>':''}${player.id===result.viewerPlayerId?'<small class="active-game__badge">YOU</small>':''}</li>`).join('');
   let controls='';
   if(canPlace){const edgeStarted=!!(mode&&(mode==='blessEdge'||mode==='smiteEdge')&&startCell),edgeConfirm=!!(edgeStarted&&endCell),modes:Array<{value:Mode;label:string}>=[{value:'blessTile',label:'BLESS TILE'},{value:'blessEdge',label:'BLESS EDGE'},{value:'smiteTile',label:'SMITE TILE'},{value:'smiteEdge',label:'SMITE EDGE'}];controls=`<section class="panel active-game__actions"><h2>GAME ACTIONS</h2><div class="active-game__action-buttons">${modes.map(item=>`<button type="button" class="secondary-button${mode===item.value?' selected':''}" data-game-mode="${item.value}" ${submitting?'disabled':''}>${item.label}</button>`).join('')}<button type="button" class="primary-button" data-end-turn ${submitting?'disabled':''}>END TURN</button></div>${mode?`<p>${mode.endsWith('Edge')?(startCell?endCell?`${escapeHtml(startCell)} → ${escapeHtml(endCell)}`:'Choose the second tile.':'Choose the first tile.'):'Choose a tile.'}</p>`:''}${edgeStarted?`<div class="active-game__confirm">${edgeConfirm?`<button type="button" class="primary-button" data-confirm-edge ${submitting?'disabled':''}>CONFIRM</button>`:''}<button type="button" class="secondary-button" data-cancel-action>CANCEL</button></div>`:''}</section>`;}
   else if(pending){if(canResolve&&pending.type==='blessEdgeMove')controls=`<section class="panel active-game__actions"><h2>RESOLVE BLESS EDGE</h2><div class="active-game__decision-list">${pending.options.map((option,index)=>`<button type="button" class="secondary-button" data-bless-option="${index}" ${submitting?'disabled':''}>${escapeHtml(describeBlessEdgeOption(option))}</button>`).join('')}</div></section>`;
    else if(canResolve&&pending.type==='smiteResource')controls=`<section class="panel active-game__actions"><h2>CHOOSE RESOURCE TO SMITE</h2><div class="active-game__action-buttons">${pending.options.map(resource=>`<button type="button" class="primary-button" data-smite-resource="${resource}" ${submitting?'disabled':''}>${resource.toUpperCase()}</button>`).join('')}</div></section>`;
    else controls=`<section class="panel active-game__actions"><p>Waiting for ${escapeHtml(playerName(pending.playerId))} to resolve ${pending.type==='blessEdgeMove'?'Bless Edge':'Smite'}.</p></section>`;}
   else if(view.phase!=='gameOver')controls=`<section class="panel active-game__actions"><p>Waiting for ${escapeHtml(playerName(view.currentPlayerId))}.</p></section>`;
   else controls=`<section class="panel active-game__actions"><h2>GAME OVER</h2><p>${view.winnerId?`${escapeHtml(playerName(view.winnerId))} wins.`:'The game has ended.'}</p></section>`;
   holder.innerHTML=`<section class="active-game"><div class="panel active-game__status"><div class="active-game__status-top"><div><p class="eyebrow">WORSHIP ME!</p><h1>ROOM ${escapeHtml(result.roomCode)}</h1><span class="active-game__version">STATE VERSION ${result.stateVersion}</span><span class="room-sync-status" data-sync-status="game" data-sync-state="${gameSyncStatus}">${syncLabel(gameSyncStatus)}</span></div><button class="primary-button compact" type="button" data-refresh-game ${submitting?'disabled':''}>REFRESH GAME</button></div><div class="active-game__turns"><p>Round ${view.round} · ${escapeHtml(view.phase)} · ${direction}</p><p>Current Turn: <strong>${escapeHtml(current?.name??view.currentPlayerId)} · ${escapeHtml(current?.color??'Unknown')}</strong></p><p>You: <strong>${escapeHtml(viewer?.name??result.viewerPlayerId)} · ${escapeHtml(viewer?.color??'Unknown')}</strong></p></div><p class="form-message" data-game-message aria-live="polite">${escapeHtml(notice)}</p></div>${controls}<div class="active-game__board-scroll"><div class="multiplayer-board">${renderBoard(view,{start:startCell,end:endCell},{interactive:canPlace})}</div></div><section class="panel active-game__players"><h2>PLAYERS</h2><ol>${players}</ol></section><p class="active-game__readonly">TRUSTED MULTIPLAYER · REALTIME VERSION SIGNALS</p></section>`;
   const refresh=holder.querySelector<HTMLButtonElement>('[data-refresh-game]')!;refresh.onclick=async()=>{if(submitting)return;refresh.disabled=true;refresh.textContent='REFRESHING…';lastSyncError=undefined;await roomSync.refresh();if(document.body.contains(refresh)){refresh.disabled=false;refresh.textContent='REFRESH GAME';}};
   holder.querySelectorAll<HTMLButtonElement>('[data-game-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.gameMode as Mode;startCell=undefined;endCell=undefined;notice='';paint();});
   holder.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(cell=>cell.onclick=()=>{if(!canPlace||submitting)return;if(!mode){notice='Choose an action first.';paint();return;}const id=cell.dataset.cell!;if(mode==='blessTile'||mode==='smiteTile'){void send({type:'placeTile',kind:mode==='blessTile'?'bless':'smite',cellId:id});return;}if(!startCell){startCell=id;notice='';paint();return;}if(!endCell&&id!==startCell){endCell=id;notice='Confirm the selected edge.';paint();}});
   const end=holder.querySelector<HTMLButtonElement>('[data-end-turn]');if(end)end.onclick=()=>void send({type:'endTurn'});
   const confirm=holder.querySelector<HTMLButtonElement>('[data-confirm-edge]');if(confirm)confirm.onclick=()=>{if(!mode||!startCell||!endCell)return;void send(mode==='blessEdge'?{type:'placeEdge',kind:'bless',from:startCell,to:endCell}:{type:'placeEdge',kind:'smite',a:startCell,b:endCell});};
   const cancel=holder.querySelector<HTMLButtonElement>('[data-cancel-action]');if(cancel)cancel.onclick=()=>{mode=undefined;startCell=undefined;endCell=undefined;notice='';paint();};
   holder.querySelectorAll<HTMLButtonElement>('[data-bless-option]').forEach(button=>button.onclick=()=>void send({type:'resolveBlessEdge',optionIndex:Number(button.dataset.blessOption)}));
   holder.querySelectorAll<HTMLButtonElement>('[data-smite-resource]').forEach(button=>button.onclick=()=>void send({type:'resolveSmiteResource',resource:button.dataset.smiteResource as 'wheat'|'bread'}));
  };
  paint();
 }
 router.start();
}
