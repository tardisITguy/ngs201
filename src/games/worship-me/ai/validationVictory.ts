import {createGame} from '../engine/setup';
import {applyAction} from '../engine/reducer';

/** Validation fixture only: resolve a legal v10 ending through the real round pipeline. */
export function createVictoryRegression(){
 let state=createGame(2,'seed-2-victory-regression',{randomizeFirstPlayer:false,randomizeDirection:false});
 for(const cell of state.board){
  cell.villagers=[];cell.priests=[];
  if(cell.visibleKind==='hidden')cell.visibleKind=cell.hiddenKind!;
 }
 const [red,purple]=state.players;
 const redTemple=state.board.find(cell=>cell.id===red.templeCellId)!;
 const purpleTemple=state.board.find(cell=>cell.id===purple.templeCellId)!;
 // Four ordinary Red Villagers become three plus one mandatory Priest in Square.
 redTemple.villagers.push(red.color,red.color,red.color,red.color);
 purpleTemple.villagers.push(purple.color);
 let purpleRemaining=9;
 for(const cell of state.board.filter(cell=>cell.visibleKind!=='temple'&&cell.visibleKind!=='square')){
  while(purpleRemaining>0&&cell.villagers.length<4){cell.villagers.push(purple.color);purpleRemaining--;}
 }
 // Both players end placement; the reducer handles production, Priests, fallback and victory.
 for(let turn=0;turn<state.players.length;turn++){
  state=applyAction(state,{type:'endTurn',playerId:state.turnOrder[state.currentPlayerIndex]});
 }
 return state;
}
