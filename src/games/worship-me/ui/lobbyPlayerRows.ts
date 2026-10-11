import type {BotStrategy} from '../engine/types';
import {WORSHIP_ME_PLAYER_COLORS,WORSHIP_ME_PLAYER_COLOR_HEX} from './playerColors';

type WorshipMePlayerColor=(typeof WORSHIP_ME_PLAYER_COLORS)[number];
export interface WorshipMeLobbyPlayer{
 control:'human'|'ai';
 participantId?:string;
 turnOrder?:number|null;
 botNumber?:number;
 displayName:string;
 playerColor:string|null;
 isCurrentUser:boolean;
 isHost:boolean;
 isReady?:boolean;
 userId?:string;
 aiPlayerId?:string;
 botStrategy?:string|null;
}
const strategyNames:Record<BotStrategy,string>={balanced:'Balanced',growth:'Growth',templeRush:'Temple Rush',random:'Random'};
const isStrategy=(value:string|null|undefined):value is BotStrategy=>value==='balanced'||value==='growth'||value==='templeRush'||value==='random';
const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const colorName=(color:string|null)=>color?color[0].toUpperCase()+color.slice(1):'No color';
const isSupportedColor=(color:string|null):color is WorshipMePlayerColor=>color!==null&&WORSHIP_ME_PLAYER_COLORS.includes(color as WorshipMePlayerColor);
function swatch(color:string|null){return isSupportedColor(color)?`<span class="player-color-swatch" style="--player-color:${WORSHIP_ME_PLAYER_COLOR_HEX[color]}" aria-hidden="true"></span>`:'';}
function colorOptions(current:string|null,occupied:Set<string>,allowClear:boolean){return`${allowClear?`<option value="" ${current===null?'selected':''}>No color</option>`:''}${WORSHIP_ME_PLAYER_COLORS.map(color=>{const selected=current===color,disabled=occupied.has(color)&&!selected;return`<option value="${color}" ${selected?'selected':''} ${disabled?'disabled':''}>${colorName(color)}${disabled?' — unavailable':''}</option>`;}).join('')}`;}
function colorControl(current:string|null,occupied:Set<string>,attribute:string,allowClear=true){return`<label class="player-color-control"><span class="visually-hidden">Choose player color</span>${swatch(current)}<select ${attribute} aria-label="Choose player color">${colorOptions(current,occupied,allowClear)}</select></label>`;}
function readonlyColor(color:string|null){const name=colorName(color);return`<span class="player-color-readonly" aria-label="Player color: ${escapeHtml(name)}">${swatch(color)}<span>${escapeHtml(name)}</span></span>`;}
function strategyControl(id:string,current:BotStrategy){return`<select class="ai-strategy-select" data-ai-strategy="${id}" aria-label="Choose strategy for AI player">${(['balanced','growth','templeRush','random'] as BotStrategy[]).map(strategy=>`<option value="${strategy}" ${strategy===current?'selected':''}>${strategyNames[strategy]}</option>`).join('')}</select>`;}

export function renderLobbyPlayerRows(players:WorshipMeLobbyPlayer[],isHost=false):string{
 const occupied=new Set(players.flatMap(player=>player.playerColor?[player.playerColor]:[]));
 return players.map(player=>{const unavailable=new Set(occupied);if(player.playerColor)unavailable.delete(player.playerColor);if(player.control==='human'){const userId=player.userId??player.participantId;if(!userId)throw Error('Human player is missing an identifier');const kick=isHost&&!player.isCurrentUser?`<button class="text-button player-kick" type="button" data-kick-player="${escapeHtml(userId)}">KICK</button>`:'';return`<li data-player-row="${escapeHtml(userId)}" ${player.isCurrentUser?'data-current-player':''}><strong class="player-name">${escapeHtml(player.displayName)}</strong><span class="player-row-meta">${player.isHost?'<span class="host-badge">HOST</span>':''}${player.isCurrentUser?colorControl(player.playerColor,unavailable,'data-player-color-select'):readonlyColor(player.playerColor)}<span class="ready-badge ${player.isReady?'is-ready':'is-not-ready'}">${player.isReady?'READY':'NOT READY'}</span>${kick}</span></li>`;}const aiPlayerId=player.aiPlayerId??player.participantId,botStrategy=player.botStrategy;if(!aiPlayerId)throw Error('AI player is missing an identifier');if(!isStrategy(botStrategy))throw Error('Unsupported AI strategy');const color=isHost?colorControl(player.playerColor,unavailable,`data-ai-color="${aiPlayerId}"`,false):readonlyColor(player.playerColor),strategy=isHost?strategyControl(aiPlayerId,botStrategy):`<span class="ai-strategy-readonly">${strategyNames[botStrategy]}</span>`,remove=isHost?`<button class="text-button ai-remove" type="button" data-ai-remove="${aiPlayerId}">REMOVE AI</button>`:'';return`<li data-ai-row="${aiPlayerId}"><strong class="player-name">${escapeHtml(player.displayName)}</strong><span class="player-row-meta"><span class="ai-badge">AI</span>${color}${strategy}${remove}</span></li>`;}).join('');
}
