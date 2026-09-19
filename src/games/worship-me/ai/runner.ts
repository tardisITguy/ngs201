import {applyAction} from '../engine/reducer';import {getLegalActions} from '../engine/legalActions';import type {AIDecisionDiagnostics,BotStrategy,GameAction,GameState} from '../engine/types';import {getPolicy} from './policies';
export interface EvaluatedBotAction{action:GameAction;rngState:number;score?:number;diagnostics:AIDecisionDiagnostics}
export function evaluateBotAction(state:GameState,strategy:BotStrategy):EvaluatedBotAction{const legal=getLegalActions(state);if(!legal.length)throw Error('No legal bot action');return getPolicy(strategy).chooseAction(state,legal)}
export function commitBotAction(state:GameState,choice:EvaluatedBotAction){const seeded={...state,rngState:choice.rngState};return applyAction(seeded,choice.action,{aiDecision:choice.diagnostics})}
