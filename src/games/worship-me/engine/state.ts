/** Public state-model exports for hosts that embed the Worship Me! engine. */
export type {
  Cell,
  GameConfig,
  GameHistory,
  GameState,
  HistoryEvent,
  HistoryEventType,
  Phase,
  Player,
  PlayerColor,
  ProductionKind,
  VillagerColor,
  VictoryResult,
} from './types';

export {createGame} from './setup';
export type {PlayerSetup} from './setup';
