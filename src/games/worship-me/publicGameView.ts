import type {ControlType,EdgeMarker,Modifier,Phase,PlacementAction,PlayerColor,TileKind,VillagerColor} from './engine/types.ts';

export interface WorshipMePublicPlayer{id:string;name:string;color:PlayerColor;templeCellId:string;priestsCreated:number;control:ControlType}
export interface WorshipMePublicCell{id:string;row:number;col:number;visibleKind:TileKind;templeOwnerId?:string;villagers:VillagerColor[];priests:PlayerColor[];wheat:number;bread:number;tileModifier?:Modifier}
export interface WorshipMePublicQueuedAction{sequence:number;placement:PlacementAction}
export interface WorshipMePublicGameView{schemaVersion:9;round:number;phase:Phase;direction:1|-1;currentPlayerId:string;players:WorshipMePublicPlayer[];board:WorshipMePublicCell[];edgeMarkers:EdgeMarker[];actionQueue:WorshipMePublicQueuedAction[];resolutionIndex:number;tileClaims:Record<string,Modifier>}

const playerColors=new Set(['red','purple','blue','cyan','green','yellow','orange','black']);
const villagerColors=new Set([...playerColors,'neutral']);
const tileKinds=new Set(['hidden','farm','bakery','home','square','temple']);
const phases=new Set(['placement','resolution','production','homeBirths','bagDraw','endRound','victory','gameOver']);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,label:string)=>{if(typeof value!=='string'||!value)throw Error(`Invalid ${label}`);return value};
const integer=(value:unknown,label:string)=>{if(!Number.isInteger(value))throw Error(`Invalid ${label}`);return value as number};
function modifier(value:unknown):Modifier|undefined{if(value===undefined)return; if(!record(value)||typeof value.playerId!=='string'||(value.kind!=='bless'&&value.kind!=='smite'))throw Error('Invalid modifier');return{playerId:value.playerId,kind:value.kind}}
function placement(value:unknown):PlacementAction{if(!record(value)||typeof value.playerId!=='string'||(value.kind!=='bless'&&value.kind!=='smite'))throw Error('Invalid placement');if(value.type==='placeTile'&&typeof value.cellId==='string')return{type:'placeTile',cellId:value.cellId,kind:value.kind,playerId:value.playerId};if(value.type==='placeEdge'&&value.kind==='bless'&&typeof value.from==='string'&&typeof value.to==='string')return{type:'placeEdge',from:value.from,to:value.to,kind:'bless',playerId:value.playerId};if(value.type==='placeEdge'&&value.kind==='smite'&&typeof value.a==='string'&&typeof value.b==='string')return{type:'placeEdge',a:value.a,b:value.b,kind:'smite',playerId:value.playerId};throw Error('Invalid placement')}

export function buildWorshipMePublicGameView(value:unknown):WorshipMePublicGameView{
 if(!record(value)||value.schemaVersion!==9||!Array.isArray(value.players)||!Array.isArray(value.turnOrder)||!Array.isArray(value.board)||value.board.length!==25||!Array.isArray(value.edgeMarkers)||!Array.isArray(value.actionQueue)||!record(value.tileClaims))throw Error('Invalid canonical game state');
 const round=integer(value.round,'round'),currentPlayerIndex=integer(value.currentPlayerIndex,'current player index'),resolutionIndex=integer(value.resolutionIndex,'resolution index');
 if(round<1||currentPlayerIndex<0||currentPlayerIndex>=value.turnOrder.length||resolutionIndex<0||!phases.has(value.phase as string)||(value.direction!==1&&value.direction!==-1))throw Error('Invalid canonical game state');
 const canonicalPlayers=new Map(value.players.map(raw=>{if(!record(raw)||!playerColors.has(raw.color as string)||(raw.control!=='human'&&raw.control!=='ai'))throw Error('Invalid player');const player:WorshipMePublicPlayer={id:text(raw.id,'player id'),name:text(raw.name,'player name'),color:raw.color as PlayerColor,templeCellId:text(raw.templeCellId,'temple cell'),priestsCreated:integer(raw.priestsCreated,'priest count'),control:raw.control};return[player.id,player] as const}));
 const order=value.turnOrder.map(id=>text(id,'turn order'));
 const players=order.map(id=>{const player=canonicalPlayers.get(id);if(!player)throw Error('Invalid turn order');return{...player}});
 const currentPlayerId=order[currentPlayerIndex];
 const board=value.board.map<WorshipMePublicCell>(raw=>{if(!record(raw)||!tileKinds.has(raw.visibleKind as string))throw Error('Invalid cell');const id=text(raw.id,'cell id'),row=integer(raw.row,'cell row'),col=integer(raw.col,'cell column');if(raw.visibleKind==='hidden'){if(!Array.isArray(raw.villagers)||raw.villagers.length!==0||!Array.isArray(raw.priests)||raw.priests.length!==0||raw.wheat!==0||raw.bread!==0||raw.templeOwnerId!==undefined||raw.tileModifier!==undefined)throw Error('Invalid canonical game state');return{id,row,col,visibleKind:'hidden',villagers:[],priests:[],wheat:0,bread:0}}if(!Array.isArray(raw.villagers)||!raw.villagers.every(color=>villagerColors.has(color))||!Array.isArray(raw.priests)||!raw.priests.every(color=>playerColors.has(color)))throw Error('Invalid cell');const cell:WorshipMePublicCell={id,row,col,visibleKind:raw.visibleKind as TileKind,villagers:[...raw.villagers] as VillagerColor[],priests:[...raw.priests] as PlayerColor[],wheat:integer(raw.wheat,'wheat'),bread:integer(raw.bread,'bread')};if(typeof raw.templeOwnerId==='string')cell.templeOwnerId=raw.templeOwnerId;const tileModifier=modifier(raw.tileModifier);if(tileModifier)cell.tileModifier=tileModifier;return cell});
 const edgeMarkers=value.edgeMarkers.map(raw=>{if(!record(raw)||typeof raw.a!=='string'||typeof raw.b!=='string'||typeof raw.playerId!=='string'||(raw.kind!=='bless'&&raw.kind!=='smite'))throw Error('Invalid edge marker');return{a:raw.a,b:raw.b,playerId:raw.playerId,kind:raw.kind} as EdgeMarker});
 const actionQueue=value.actionQueue.map(raw=>{if(!record(raw))throw Error('Invalid queued action');return{sequence:integer(raw.sequence,'action sequence'),placement:placement(raw.placement)}});
 const tileClaims=Object.fromEntries(Object.entries(value.tileClaims).map(([id,raw])=>{const claim=modifier(raw);if(!claim)throw Error('Invalid tile claim');return[id,claim]}));
 return{schemaVersion:9,round,phase:value.phase as Phase,direction:value.direction,currentPlayerId,players,board,edgeMarkers,actionQueue,resolutionIndex,tileClaims};
}
