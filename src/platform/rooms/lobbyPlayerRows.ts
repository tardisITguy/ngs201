import {WORSHIP_ME_PLAYER_COLORS,WORSHIP_ME_PLAYER_COLOR_HEX} from '../../games/worship-me/ui/playerColors';
import type {LobbyPlayer} from './lobby';

type WorshipMePlayerColor=(typeof WORSHIP_ME_PLAYER_COLORS)[number];

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const colorName=(color:string|null)=>color?color[0].toUpperCase()+color.slice(1):'No color';
const isSupportedColor=(color:string|null):color is WorshipMePlayerColor=>color!==null&&WORSHIP_ME_PLAYER_COLORS.includes(color as WorshipMePlayerColor);

function swatch(color:string|null){
 if(!isSupportedColor(color))return'';
 return`<span class="player-color-swatch" style="--player-color:${WORSHIP_ME_PLAYER_COLOR_HEX[color]}" aria-hidden="true"></span>`;
}

function currentPlayerColorControl(player:LobbyPlayer,occupiedColors:Set<string>){
 const options=[`<option value="" ${player.playerColor===null?'selected':''}>No color</option>`,...WORSHIP_ME_PLAYER_COLORS.map(color=>{
  const selected=player.playerColor===color,disabled=occupiedColors.has(color)&&!selected;
  return`<option value="${color}" ${selected?'selected':''} ${disabled?'disabled':''}>${colorName(color)}${disabled?' — unavailable':''}</option>`;
 })].join('');
 return`<label class="player-color-control"><span class="visually-hidden">Choose your player color</span>${swatch(player.playerColor)}<select data-player-color-select aria-label="Choose your player color">${options}</select></label>`;
}

function readonlyPlayerColor(color:string|null){
 const name=colorName(color);
 return`<span class="player-color-readonly" aria-label="Player color: ${escapeHtml(name)}">${swatch(color)}<span>${escapeHtml(name)}</span></span>`;
}

export function renderLobbyPlayerRows(players:LobbyPlayer[]):string{
 const occupiedColors=new Set(players.filter(player=>!player.isCurrentUser&&player.playerColor).map(player=>player.playerColor!));
 return players.map(player=>`<li data-player-row="${escapeHtml(player.userId)}" ${player.isCurrentUser?'data-current-player':''}><strong class="player-name">${escapeHtml(player.displayName)}</strong><span class="player-row-meta">${player.isHost?'<span class="host-badge">HOST</span>':''}${player.isCurrentUser?currentPlayerColorControl(player,occupiedColors):readonlyPlayerColor(player.playerColor)}<span class="ready-badge ${player.isReady?'is-ready':'is-not-ready'}">${player.isReady?'READY':'NOT READY'}</span></span></li>`).join('');
}
