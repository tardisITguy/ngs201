import type {GameState} from '../engine/types';
export interface MoveSelection{start?:string;end?:string;resource?:'wheat'|'bread';resourceOnly:boolean}
export const emptyMoveSelection=():MoveSelection=>({resourceOnly:false});
export function selectMoveCell(selection:MoveSelection,id:string){return !selection.start?{...selection,start:id}:{...selection,end:id}}
export const cancelMove=()=>emptyMoveSelection();
export function cargoChoices(s:GameState,selection:MoveSelection){if(!selection.start)return[];const c=s.board.find(c=>c.id===selection.start)!;return(['wheat','bread'] as const).filter(x=>c[x]>0)}
export function defaultMoveChoice(s:GameState,selection:MoveSelection){if(!selection.start)return'villager';const c=s.board.find(c=>c.id===selection.start)!;return c.visibleKind==='farm'&&c.wheat>0?'carry-wheat':c.visibleKind==='bakery'&&c.bread>0?'carry-bread':'villager'}
export function ownMoverRoles(s:GameState,selection:MoveSelection){if(!selection.start)return[];const c=s.board.find(c=>c.id===selection.start)!,player=s.players.find(p=>p.id===s.turnOrder[s.currentPlayerIndex])!;const roles:('ordinary'|'priest')[]=[];if(c.villagers.includes(player.color))roles.push('ordinary');if(c.priests.includes(player.color))roles.push('priest');return roles}
