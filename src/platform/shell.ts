import {listActiveGames} from './games/catalog';
import {getDisplayName,saveIdentity,validateDisplayName} from './identity';
import {createRouter,type Route} from './router';
import {createHostAction} from './rooms/host';
import {getLobby} from './rooms/lobby';

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const logo=()=>`<a class="brand" href="/" data-link aria-label="New Game Studios home"><img src="/brand/ngs/bannerlogo.png" alt="New Game Studios"><span>THE FUTURE IS NEW</span></a>`;
const header=(game=false)=>`<header class="shell-header">${logo()}${game?'<strong class="game-mark">WORSHIP ME!</strong>':''}</header>`;
const page=(content:string,game=false)=>`<div class="play-shell">${header(game)}<main class="shell-main">${content}</main></div>`;
const button=(label:string,attrs='')=>`<button class="primary-button" ${attrs}>${label}</button>`;

export function startPlayShell(root:HTMLDivElement){
 const host=createHostAction();
 const router=createRouter(window,route=>void render(route));
 root.addEventListener('click',event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[data-link]');if(link){event.preventDefault();router.navigate(new URL(link.href).pathname);}});

 async function render(route:Route){
  if(route.name==='identity')return renderIdentity();
  if(route.name==='games')return renderGames();
  if(route.name==='worship-me')return renderGameLanding();
  if(route.name==='room')return renderLobby(route.code);
  root.innerHTML=page(`<section class="panel centered"><p class="eyebrow">404</p><h1>Page not found</h1><a class="text-link" href="/" data-link>Return home</a></section>`);
 }

 function renderIdentity(){
  const name=getDisplayName();
  root.innerHTML=page(`<section class="identity panel"><p class="eyebrow">WELCOME</p><h1>Ready to play?</h1><p class="lede">Choose the name other players will see.</p><form data-identity novalidate><label for="display-name">What should we call you?</label><input id="display-name" name="displayName" value="${escapeHtml(name)}" maxlength="50" autocomplete="nickname" autofocus><p class="form-message" data-message aria-live="polite"></p>${button('CONTINUE','type="submit"')}</form></section>`);
  const form=root.querySelector<HTMLFormElement>('[data-identity]')!,input=form.elements.namedItem('displayName') as HTMLInputElement,message=form.querySelector<HTMLElement>('[data-message]')!,submit=form.querySelector<HTMLButtonElement>('button')!;
  form.onsubmit=async event=>{event.preventDefault();const validation=validateDisplayName(input.value);if(validation){message.textContent=validation;input.focus();return;}submit.disabled=true;submit.textContent='STARTING SESSION…';message.textContent='';try{await saveIdentity(input.value);router.navigate('/games');}catch{message.textContent='We could not start your player session. Check your connection and try again.';submit.disabled=false;submit.textContent='CONTINUE';}};
 }

 async function renderGames(){
  root.innerHTML=page(`<section class="catalog"><div class="section-heading"><p class="eyebrow">NGS PLAY</p><h1>Games</h1><p>Pick a world. Bring your people.</p></div><div class="status-panel" role="status"><span class="spinner"></span> Loading games…</div></section>`);
  try{const games=await listActiveGames();if(!games.length){root.querySelector('.catalog')!.innerHTML+=`<div class="status-panel"><h2>No active games yet</h2><p>New worlds are being prepared.</p></div>`;root.querySelector('.status-panel[role]')?.remove();return;}const cards=games.map(game=>game.slug==='worship-me'?`<a class="game-card worship-card" href="/games/worship-me" data-link><div class="token-orbit" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><p class="eyebrow">STRATEGY · 2–8 PLAYERS</p><h2>${escapeHtml(game.name)}</h2><p>Rule the Faithful.</p><span class="card-action">VIEW GAME →</span></div></a>`:`<article class="game-card"><h2>${escapeHtml(game.name)}</h2></article>`).join('');root.querySelector('.status-panel')!.outerHTML=`<div class="game-grid">${cards}</div>`;}catch{root.querySelector('.status-panel')!.outerHTML=`<div class="status-panel error"><h2>Games couldn't load</h2><p>Check your connection, then try again.</p>${button('RETRY','data-retry')}</div>`;root.querySelector<HTMLButtonElement>('[data-retry]')!.onclick=()=>void renderGames();}
 }

 function renderGameLanding(){
  root.innerHTML=page(`<section class="game-hero"><a class="back-link" href="/games" data-link>← Back to Games</a><div class="worship-emblem" aria-hidden="true">W</div><p class="eyebrow">AN NGS ORIGINAL</p><h1>WORSHIP ME!</h1><p class="hero-tagline">Rule the Faithful.</p><p class="hero-copy">Build belief, command your followers, and outlast rival gods in a strategic struggle for devotion.</p><div class="hero-actions">${button('HOST GAME','data-host')}<button class="secondary-button" disabled>JOIN GAME <small>COMING NEXT</small></button></div><p class="form-message" data-message aria-live="polite"></p></section>`,true);
  const hostButton=root.querySelector<HTMLButtonElement>('[data-host]')!,message=root.querySelector<HTMLElement>('[data-message]')!;
  hostButton.onclick=async()=>{const displayName=getDisplayName();if(!displayName){router.navigate('/');return;}hostButton.disabled=true;hostButton.textContent='CREATING ROOM…';message.textContent='';try{const result=await host(displayName);if(result)router.navigate(`/room/${encodeURIComponent(result.room.code)}`);}catch{message.textContent='We could not create the room. Please try again.';}finally{if(document.body.contains(hostButton)){hostButton.disabled=false;hostButton.textContent='HOST GAME';}}};
 }

 async function renderLobby(code:string){
  root.innerHTML=page(`<section class="lobby"><div class="status-panel" role="status"><span class="spinner"></span> Loading room…</div></section>`,true);
  try{const lobby=await getLobby(code);const players=lobby.players.map(player=>`<li><span class="ready-icon" aria-label="${player.isReady?'Ready':'Not ready'}">${player.isReady?'✓':'○'}</span><strong>${escapeHtml(player.displayName)}</strong>${player.playerColor?`<span class="color-label">${escapeHtml(player.playerColor)}</span>`:''}${player.isHost?'<span class="host-badge">HOST</span>':''}</li>`).join('');root.querySelector('.lobby')!.innerHTML=`<a class="back-link" href="/games/worship-me" data-link>← Worship Me!</a><section class="room-banner"><div><p class="eyebrow">ROOM · ${escapeHtml(lobby.room.status.toUpperCase())}</p><h1>${escapeHtml(lobby.room.code)}</h1></div><button class="secondary-button compact" data-copy>Copy code</button></section><section class="lobby-grid"><div class="panel"><div class="panel-title"><h2>Players</h2><button class="text-button" data-refresh>Refresh</button></div><ul class="player-list">${players||'<li>No players found.</li>'}</ul></div><div class="panel future-panel"><h2>Choose color</h2><div class="color-options"><button disabled>Red</button><button disabled>Blue</button><button disabled>Green</button><button disabled>Yellow</button></div><span class="coming">COMING NEXT</span></div><div class="panel chat-panel"><h2>Chat</h2><p>Chat will appear here in the next multiplayer step.</p><span class="coming">COMING NEXT</span></div><div class="lobby-actions"><button class="secondary-button" disabled>READY <small>COMING NEXT</small></button>${lobby.room.isCurrentUserHost?'<button class="primary-button" disabled>START GAME <small>COMING NEXT</small></button>':''}</div></section>`;root.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>void renderLobby(code);const copy=root.querySelector<HTMLButtonElement>('[data-copy]')!;copy.onclick=async()=>{try{await navigator.clipboard.writeText(lobby.room.code);copy.textContent='Copied!';}catch{copy.textContent='Copy unavailable';}};}catch(error){const message=error instanceof Error?error.message:"You don't have access to this room.";root.querySelector('.lobby')!.innerHTML=`<section class="status-panel error"><h1>Room unavailable</h1><p>${escapeHtml(message)}</p><a class="text-link" href="/games" data-link>Back to Games</a></section>`;}
 }
 router.start();
}
