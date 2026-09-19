import type {AIDecisionDiagnostics,AIResolutionDiagnostics,BotStrategy,GameAction,GameState,ResolutionDecision} from '../engine/types';

export interface BotChoice{action:GameAction;rngState:number;score?:number;diagnostics:AIDecisionDiagnostics}
export interface ResolutionChoice{decision:ResolutionDecision;rngState:number;diagnostics?:AIResolutionDiagnostics}
export interface BotPolicy{
 id:BotStrategy;name:string;
 chooseAction(state:GameState,legalActions:GameAction[]):BotChoice;
 choosePendingResolution(state:GameState):ResolutionChoice;
}
