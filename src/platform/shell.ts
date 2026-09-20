import {listActiveGames} from './games/catalog';
import {getDisplayName,saveIdentity,validateDisplayName} from './identity';
import {createRouter,type Route} from './router';
import {createHostAction} from './rooms/host';
import {createJoinAction,normalizeRoomCode} from './rooms/joinRoom';
import {createLeaveAction} from './rooms/leaveRoom';
import {createSetPlayerColorAction,SetPlayerColorError} from './rooms/setPlayerColor';
import {createSetPlayerReadyAction,SetPlayerReadyError} from './rooms/setPlayerReady';
import {getLobby} from './rooms/lobby';
import {renderLobbyPlayerRows} from './rooms/lobbyPlayerRows';
import {defaultConfig} from '../games/worship-me/engine/config';
import {WORSHIP_ME_PLAYER_COLORS} from '../games/worship-me/ui/playerColors';
import './colorSelection.css';

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
 let identityReturnPath:string|undefined;
 const router=createRouter(window,route=>void render(route));
 root.addEventListener('click',event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[data-link]');if(link){event.preventDefault();router.navigate(new URL(link.href).pathname);}});

 async function render(route:Route){
  if(route.name==='identity')return renderIdentity();
  if(route.name==='games')return renderGames();
  if(route.name==='worship-me')return renderGameLanding();
  if(route.name==='worship-me-join'){
   if(!getDisplayName()){identityReturnPath='/games/worship-me/join';router.navigate('/');return;}
   return renderJoin();
  }
  if(route.name==='room')return renderLobby(route.code);
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

 async function renderLobby(code:string,lobbyNotice=''){
  root.innerHTML=page(`<section class="lobby"><div class="status-panel" role="status"><span class="spinner"></span> Loading room…</div></section>`,true);
  try{
   const lobby=await getLobby(code);
   const players=renderLobbyPlayerRows(lobby.players);
   const currentPlayer=lobby.players.find(player=>player.isCurrentUser),canReady=WORSHIP_ME_PLAYER_COLORS.includes(currentPlayer?.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]),readyLabel=currentPlayer?.isReady?'NOT READY':'READY';
   const allReadyPreview=lobby.players.length>=defaultConfig.playerMin&&lobby.players.every(player=>player.isReady&&WORSHIP_ME_PLAYER_COLORS.includes(player.playerColor as (typeof WORSHIP_ME_PLAYER_COLORS)[number]));
   const hostHelp=lobby.room.isCurrentUserHost?'<p class="lobby-controls__help">If other players remain, host control passes to the longest-waiting player.</p>':'';
   const startGame=lobby.room.isCurrentUserHost?`<button class="primary-button compact" type="button" disabled>START GAME <small>${allReadyPreview?'READY TO START · COMING NEXT':'WAITING FOR ALL PLAYERS'}</small></button>`:'';
   const readyHelp=!currentPlayer?.isReady&&!canReady?'<span class="ready-help" id="ready-help">Choose a color first</span>':'';
   root.querySelector('.lobby')!.innerHTML=`<section class="lobby-controls" aria-labelledby="lobby-controls-heading"><h1 id="lobby-controls-heading">LOBBY CONTROLS</h1><div class="lobby-controls__bar"><div class="lobby-controls__room"><span class="lobby-controls__label">ROOM</span><strong class="lobby-controls__code">${escapeHtml(lobby.room.code)}</strong><button class="secondary-button compact" type="button" data-copy>Copy Code</button><button class="secondary-button compact future-control" type="button" disabled aria-describedby="name-room-status">Name Room <small id="name-room-status">COMING NEXT</small></button></div><div class="lobby-controls__actions"><button class="secondary-button compact" type="button" data-leave>LEAVE LOBBY</button><span class="ready-control"><button class="secondary-button compact" type="button" data-ready ${!currentPlayer||(!currentPlayer.isReady&&!canReady)?'disabled':''} ${readyHelp?'aria-describedby="ready-help"':''}>${readyLabel}</button>${readyHelp}</span>${startGame}</div></div>${hostHelp}<div class="lobby-controls__messages"><p class="form-message" data-lobby-message aria-live="polite">${escapeHtml(lobbyNotice)}</p><p class="form-message" data-leave-message aria-live="polite"></p></div></section><section class="lobby-content-grid"><div class="panel players-panel"><div class="panel-title"><h2>PLAYERS</h2><button class="text-button" data-refresh>Refresh</button></div><ul class="player-list">${players||'<li>No players found.</li>'}</ul></div><div class="panel chat-panel"><h2>CHAT</h2><div class="chat-panel__placeholder"><p>Chat will appear here in the next multiplayer step.</p><span class="coming">COMING NEXT</span></div></div></section>`;
   root.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>void renderLobby(code);
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
    try{await setColor({roomCode:lobby.room.code,playerColor});await renderLobby(code);}
    catch(error){const message=error instanceof SetPlayerColorError?error.message:'Unable to update player color.';await renderLobby(code,message);}
   };
   const readyButton=root.querySelector<HTMLButtonElement>('[data-ready]');
   if(readyButton&&currentPlayer)readyButton.onclick=async()=>{
    readyButton.disabled=true;readyButton.textContent='UPDATING…';lobbyMessage.textContent='Updating Ready state...';
    try{await setReady({roomCode:lobby.room.code,isReady:!currentPlayer.isReady});await renderLobby(code);}
    catch(error){const message=error instanceof SetPlayerReadyError?error.message:'Unable to update Ready state.';await renderLobby(code,message);}
   };
  }catch(error){const message=error instanceof Error?error.message:"You don't have access to this room.";root.querySelector('.lobby')!.innerHTML=`<section class="status-panel error"><h1>Room unavailable</h1><p>${escapeHtml(message)}</p><a class="text-link" href="/games" data-link>Back to Games</a></section>`;}
 }
 router.start();
}
