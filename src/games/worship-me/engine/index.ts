/**
 * Public, environment-neutral Worship Me! engine API.
 *
 * A future authoritative server should create/load GameState, validate a
 * submitted GameAction, and invoke this same reducer. UI, storage, transport,
 * authentication, and room orchestration intentionally live outside here.
 */
export {createGame} from './setup';
export type {PlayerSetup} from './setup';
export {
  applyAction,
  applyAction as reducer,
  advanceResolution,
  remainingPlacements,
  resolvePendingDecision,
  startNextRound,
} from './reducer';
export {getLegalActions,actionIsSmite,actionKey} from './legalActions';
export {validatePlacement,placementUnavailableReason} from './placementLegality';
export {serializeGame,deserializeGame} from './serialization';
export {exportPlayByPlay,playByPlayFilename} from './history';
export {checkVictory,allVillageTilesFaceUp,followerTotal,followersInOwnTemple} from './victory';
export type {
  BotStrategy,
  GameAction,
  GameConfig,
  GameState,
  PendingResolution,
  PlacementAction,
  PlacementKind,
  ResolutionDecision,
  VictoryResult,
} from './types';
