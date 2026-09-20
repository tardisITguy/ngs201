import {defaultConfig} from './config.ts';
import {hashSeed,next,shuffle} from './rng.ts';
import {cellId} from './board.ts';
import {templePositions} from './perimeter.ts';
import {MAX_NEUTRALS_IN_PLAY} from './neutrals.ts';
import {createHistory} from './history.ts';
import type {BotStrategy,Cell,ControlType,GameConfig,GameState,PlayerColor,ProductionKind} from './types.ts';

const colors:PlayerColor[]=['red','purple','blue','cyan','green','yellow','orange','black'];
export interface PlayerSetup{name:string;color?:PlayerColor;control?:ControlType;botStrategy?:BotStrategy}

export function createGame(playerInput:number|PlayerSetup[],seed='worship-me',overrides:Partial<GameConfig>={}):GameState{
 const config={...defaultConfig,...overrides};
 if(config.startingNeutralVillagers>MAX_NEUTRALS_IN_PLAY)throw Error(`Starting Neutral count cannot exceed ${MAX_NEUTRALS_IN_PLAY}`);
 const specs:PlayerSetup[]=typeof playerInput==='number'?Array.from({length:playerInput},(_,i)=>({name:`Player ${i+1}`})):playerInput;
 if(specs.length<config.playerMin||specs.length>config.playerMax)throw Error('Player count must be 2–8');
 let rngState=hashSeed(seed);
 let tiles:ProductionKind[]=[...Array(config.farmCount).fill('farm'),...Array(config.bakeryCount).fill('bakery'),...Array(config.homeCount).fill('home')];
 [tiles,rngState]=shuffle(tiles,rngState);
 let ti=0;const board:Cell[]=[];
 for(let row=0;row<5;row++)for(let col=0;col<5;col++)board.push(row===2&&col===2
  ?{id:cellId(row,col),row,col,visibleKind:'square',villagers:Array(Math.min(config.startingNeutralVillagers,specs.length)).fill('neutral'),priests:[],wheat:0,bread:0}
  :{id:cellId(row,col),row,col,visibleKind:'hidden',hiddenKind:tiles[ti++],villagers:[],priests:[],wheat:0,bread:0});
 const positions=templePositions(specs.length),removedVillageTiles:ProductionKind[]=[];
 const players=specs.map((s,i)=>({id:`p${i+1}`,name:s.name,color:s.color??colors[i],templeCellId:positions[i],priestsCreated:0,control:s.control??'human' as ControlType,botStrategy:s.botStrategy}));
 for(const p of players){const c=board.find(x=>x.id===p.templeCellId)!;removedVillageTiles.push(c.hiddenKind!);delete c.hiddenKind;c.visibleKind='temple';c.templeOwnerId=p.id}
 let first=0,direction:1|-1=1;
 if(config.randomizeFirstPlayer){let n;[n,rngState]=next(rngState);first=Math.floor(n*players.length)}
 if(config.randomizeDirection){let n;[n,rngState]=next(rngState);direction=n<.5?1:-1}
 const turnOrder=players.map(p=>p.id);
 const placementsUsed=Object.fromEntries(players.map(p=>[p.id,0])),smiteUsed=Object.fromEntries(players.map(p=>[p.id,false])),extraBlessThisRound=Object.fromEntries(players.map(p=>[p.id,0])),extraBlessNextRound=Object.fromEntries(players.map(p=>[p.id,0])),placementPenaltyThisRound=Object.fromEntries(players.map(p=>[p.id,0])),nextRoundPlacementPenalty=Object.fromEntries(players.map(p=>[p.id,0]));
 return{schemaVersion:9,seed,rngState,round:1,players,turnOrder,currentPlayerIndex:first,direction,turnsTaken:0,actionsUsedThisTurn:0,smiteUsedThisTurn:false,board,removedVillageTiles,edgeMarkers:[],newVillagerBag:[],pendingDirectionFlip:false,phase:'placement',eventLog:[`Game created with seed ${seed}`],history:createHistory(direction,turnOrder[first]),revealCompleted:false,config,actionQueue:[],resolutionIndex:0,placementSequence:0,placementsUsed,smiteUsed,extraBlessThisRound,extraBlessNextRound,placementPenaltyThisRound,nextRoundPlacementPenalty,tileClaims:{},edgeClaims:{},templesTargeted:[]};
}
