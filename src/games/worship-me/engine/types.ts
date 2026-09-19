export type ProductionKind='farm'|'bakery'|'home';
export type TileKind='hidden'|ProductionKind|'square'|'temple';
export type PlayerColor='red'|'purple'|'blue'|'cyan'|'green'|'yellow'|'orange'|'black';
export type VillagerColor=PlayerColor|'neutral';
export type BotStrategy='random'|'growth'|'templeRush'|'balanced';export type ControlType='human'|'ai';
export interface Modifier{playerId:string;kind:'bless'|'smite'}
export interface Cell{id:string;row:number;col:number;hiddenKind?:ProductionKind;visibleKind:TileKind;templeOwnerId?:string;villagers:VillagerColor[];priests:PlayerColor[];wheat:number;bread:number;tileModifier?:Modifier}
export interface EdgeMarker{a:string;b:string;playerId:string;kind:'bless'|'smite'}
export interface Player{id:string;name:string;color:PlayerColor;templeCellId:string;priestsCreated:number;lastPriestCreationRound?:number;control:ControlType;botStrategy?:BotStrategy}
export interface GameConfig{playerMin:number;playerMax:number;startingNeutralVillagers:number;farmCount:number;bakeryCount:number;homeCount:number;templeTriggerFollowers:number;normalFarmYieldPerVillager:number;blessedFarmYieldPerVillager:number;normalBakeryWheatCost:number;blessedBakeryWheatCost:number;homeBreadCost:number;endRoundDrawsPerPlayer:number;randomizeFirstPlayer:boolean;randomizeDirection:boolean}
export interface ScoreComponents{base:number;templeProgress:number;templePreservation:number;endTriggerValue:number;resourceValue:number;productionValue:number;populationGrowth:number;priestValue:number;disruption:number;exploration:number;mobility:number;resourceRemovalValue:number;productionPreventedValue:number;strategicDisruptionValue:number;populationReleaseValue:number;squareCongestionValue:number;terminalPressure:number;resourceSaturationPenalty:number;stagnationPenalty:number;reversalPenalty:number;riskPenalty:number}
export interface AICandidateDiagnostic{rank:number;label:string;score:number;components:ScoreComponents;action:PlacementAction}
export interface AIDecisionDiagnostics{strategy:BotStrategy;legalCandidateCounts:{blessTile:number;blessEdge:number;smiteTile:number;smiteEdge:number;templeActions:number;totalPlacements:number;endTurnAvailable:boolean};topCandidates:AICandidateDiagnostic[];selected:{label:string;score:number;rank:number|null}}
export interface AIResolutionCandidateDiagnostic{rank:number;choice:string;score:number;components:ScoreComponents;optionIndex?:number;resource?:'wheat'|'bread'}
export interface AIResolutionDiagnostics{strategy:BotStrategy;resolutionType:PendingResolution['type'];resolutionCandidates:AIResolutionCandidateDiagnostic[];selectedResolution:string;selectedScore:number}
export type Phase='placement'|'resolution'|'production'|'homeBirths'|'bagDraw'|'endRound'|'victory'|'gameOver';
export type PlacementKind='bless'|'smite';
export interface TilePlacement{type:'placeTile';cellId:string;kind:PlacementKind;playerId:string}
export interface BlessEdgePlacement{type:'placeEdge';from:string;to:string;kind:'bless';playerId:string}
export interface SmiteEdgePlacement{type:'placeEdge';a:string;b:string;kind:'smite';playerId:string}
export type EdgePlacement=BlessEdgePlacement|SmiteEdgePlacement;
export type PlacementAction=TilePlacement|EdgePlacement;
export type GameAction=PlacementAction|{type:'endTurn';playerId:string};
export interface QueuedAction{sequence:number;placement:PlacementAction}
export interface MoveResolutionOption{from:string;to:string;moverRole?:'ordinary'|'priest';moverColor?:VillagerColor;resource?:'wheat'|'bread';resourceOnly?:boolean;neutral?:boolean;opponent?:boolean}
export type PendingResolution=
 |{type:'blessEdgeMove';queueIndex:number;playerId:string;options:MoveResolutionOption[]}
 |{type:'smiteResource';queueIndex:number;playerId:string;cellId:string;options:('wheat'|'bread')[]};
export type ResolutionDecision=
 |{type:'resolveBlessEdge';playerId:string;optionIndex:number}
 |{type:'resolveSmiteResource';playerId:string;resource:'wheat'|'bread'};
export type HistoryEventType='placement'|'resolutionDecision'|'resolution'|'production'|'roundBoundary'|'placementTurnStarted'|'templeSmite'|'victoryCheck';
export interface HistoryEvent{id:string;ordinal:number;type:HistoryEventType;round:number;description:string;queuedActionId?:string;playerId?:string;playerName?:string;playerColor?:PlayerColor;decisionSource?:ControlType;aiStrategy?:BotStrategy;data:Record<string,unknown>}
export interface GameHistory{rulesVersion:string;startedAt:string;initialDirection:1|-1;initialFirstPlayerId:string;nextOrdinal:number;events:HistoryEvent[]}
export interface GameState{schemaVersion:9;seed:string;rngState:number;round:number;players:Player[];turnOrder:string[];currentPlayerIndex:number;direction:1|-1;phase:Phase;board:Cell[];removedVillageTiles:ProductionKind[];edgeMarkers:EdgeMarker[];newVillagerBag:VillagerColor[];eventLog:string[];history:GameHistory;winnerId?:string;revealCompleted:boolean;config:GameConfig;actionQueue:QueuedAction[];resolutionIndex:number;placementSequence:number;placementsUsed:Record<string,number>;smiteUsed:Record<string,boolean>;extraBlessThisRound:Record<string,number>;extraBlessNextRound:Record<string,number>;placementPenaltyThisRound:Record<string,number>;nextRoundPlacementPenalty:Record<string,number>;pendingResolution?:PendingResolution;persistentFirstPlayerId?:string;pendingDirectionFlip:boolean;tileClaims:Record<string,Modifier>;edgeClaims:Record<string,Modifier>;templesTargeted:string[];actionsUsedThisTurn:number;smiteUsedThisTurn:boolean;turnsTaken:number}
export interface VictoryResult{winnerId?:string;reason:'not-revealed'|'no-temple-trigger'|'tie'|'winner';allVillageTilesRevealed:boolean;templeTriggerSatisfied:boolean;triggeringPlayerIds:string[];gameEnds:boolean;followerTotals:Record<string,number>;highestFollowerTotal?:number}
