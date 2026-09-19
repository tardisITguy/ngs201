import {applyAction} from '../engine/reducer';
import type {GameAction,GameState} from '../engine/types';
export const commit=(state:GameState,action:GameAction)=>applyAction(state,action);
