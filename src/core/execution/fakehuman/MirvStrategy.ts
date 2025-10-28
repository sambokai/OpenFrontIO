import {
  Game,
  Gold,
  Player,
  PlayerType,
  Tick,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { MirvExecution } from "../MIRVExecution";
import { calculateTerritoryCenter } from "../Util";

export class MirvStrategy {
  private readonly lastMIRVSent: [Tick, TileRef][] = [];
  private mirvTargetsCache: {
    tick: number;
    players: Player[];
  } | null = null;

  /** Ticks until MIRV can be attempted again */
  private static readonly MIRV_COOLDOWN_TICKS = 20;

  /** Odds of aborting a MIRV attempt */
  private static readonly MIRV_HESITATION_ODDS = 7;

  /** Threshold for team victory denial */
  private static readonly VICTORY_DENIAL_TEAM_THRESHOLD = 0.8;

  /** Threshold for individual victory denial */
  private static readonly VICTORY_DENIAL_INDIVIDUAL_THRESHOLD = 0.65;

  /** Multiplier for steamroll city gap threshold */
  private static readonly STEAMROLL_CITY_GAP_MULTIPLIER = 1.3;

  /** Minimum city count for leader to trigger steam roll detection */
  private static readonly STEAMROLL_MIN_LEADER_CITIES = 10;

  constructor(
    private mg: Game,
    private player: Player,
    private random: PseudoRandom,
  ) {}

  public considerMIRV(): Player | null {
    if (this.player.units(UnitType.MissileSilo).length === 0) {
      return null;
    }
    if (this.player.gold() < this.cost(UnitType.MIRV)) {
      return null;
    }

    this.removeOldMIRVEvents();
    if (this.lastMIRVSent.length > 0) {
      return null;
    }

    if (this.random.chance(MirvStrategy.MIRV_HESITATION_ODDS)) {
      this.triggerMIRVCooldown();
      return null;
    }

    const inboundMIRVSender = this.selectCounterMirvTarget();
    if (inboundMIRVSender) {
      return inboundMIRVSender;
    }

    const victoryDenialTarget = this.selectVictoryDenialTarget();
    if (victoryDenialTarget) {
      return victoryDenialTarget;
    }

    const steamrollStopTarget = this.selectSteamrollStopTarget();
    if (steamrollStopTarget) {
      return steamrollStopTarget;
    }

    return null;
  }

  public launchMirv(enemy: Player): void {
    const enemyTiles = Array.from(enemy.tiles());
    if (enemyTiles.length === 0) return;

    const centerTile = this.calculateTerritoryCenter(enemy);
    if (centerTile && this.player.canBuild(UnitType.MIRV, centerTile)) {
      this.sendMIRV(centerTile);
      return;
    }
    for (const tile of enemyTiles) {
      if (this.player.canBuild(UnitType.MIRV, tile)) {
        this.sendMIRV(tile);
        return;
      }
    }
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }

  private selectCounterMirvTarget(): Player | null {
    const attackers = this.getValidMirvTargetPlayers().filter((p) =>
      this.isInboundMIRVFrom(p),
    );
    if (attackers.length === 0) return null;
    attackers.sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    return attackers[0];
  }

  private selectVictoryDenialTarget(): Player | null {
    const totalLand = this.mg.numLandTiles();
    if (totalLand === 0) return null;
    let best: { p: Player; severity: number } | null = null;
    for (const p of this.getValidMirvTargetPlayers()) {
      let severity = 0;
      const team = p.team();
      if (team !== null) {
        const teamMembers = this.mg
          .players()
          .filter((x) => x.team() === team && x.isPlayer());
        const teamTerritory = teamMembers
          .map((x) => x.numTilesOwned())
          .reduce((a, b) => a + b, 0);
        const teamShare = teamTerritory / totalLand;
        if (teamShare >= MirvStrategy.VICTORY_DENIAL_TEAM_THRESHOLD) {
          // Only consider the largest team member as the target when team exceeds threshold
          let largestMember: Player | null = null;
          let largestTiles = -1;
          for (const member of teamMembers) {
            const tiles = member.numTilesOwned();
            if (tiles > largestTiles) {
              largestTiles = tiles;
              largestMember = member;
            }
          }
          if (largestMember === p) {
            severity = teamShare;
          } else {
            severity = 0; // Skip non-largest members
          }
        }
      } else {
        const share = p.numTilesOwned() / totalLand;
        if (share >= MirvStrategy.VICTORY_DENIAL_INDIVIDUAL_THRESHOLD)
          severity = share;
      }
      if (severity > 0) {
        if (best === null || severity > best.severity) best = { p, severity };
      }
    }
    return best ? best.p : null;
  }

  private selectSteamrollStopTarget(): Player | null {
    const validTargets = this.getValidMirvTargetPlayers();

    if (validTargets.length === 0) return null;

    const allPlayers = this.mg
      .players()
      .filter((p) => p.isPlayer())
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (allPlayers.length < 2) return null;

    const topPlayer = allPlayers[0];

    if (topPlayer.cityCount <= MirvStrategy.STEAMROLL_MIN_LEADER_CITIES)
      return null;

    const secondHighest = allPlayers[1].cityCount;

    const threshold =
      secondHighest * MirvStrategy.STEAMROLL_CITY_GAP_MULTIPLIER;

    if (topPlayer.cityCount >= threshold) {
      return validTargets.some((p) => p === topPlayer.p) ? topPlayer.p : null;
    }

    return null;
  }

  // MIRV Helper Methods
  private getValidMirvTargetPlayers(): Player[] {
    const MIRV_TARGETS_CACHE_TICKS = 2 * 10; // 2 seconds

    if (
      this.mirvTargetsCache &&
      this.mg.ticks() - this.mirvTargetsCache.tick < MIRV_TARGETS_CACHE_TICKS
    ) {
      return this.mirvTargetsCache.players;
    }

    const players = this.mg.players().filter((p) => {
      return (
        p !== this.player &&
        p.isPlayer() &&
        p.type() !== PlayerType.Bot &&
        !this.player!.isOnSameTeam(p)
      );
    });

    this.mirvTargetsCache = { tick: this.mg.ticks(), players };
    return players;
  }

  private isInboundMIRVFrom(attacker: Player): boolean {
    const enemyMirvs = attacker.units(UnitType.MIRV);
    for (const mirv of enemyMirvs) {
      const dst = mirv.targetTile();
      if (!dst) continue;
      if (!this.mg.hasOwner(dst)) continue;
      const owner = this.mg.owner(dst);
      if (owner === this.player) {
        return true;
      }
    }
    return false;
  }

  private countCities(p: Player): number {
    return p.unitCount(UnitType.City);
  }

  private calculateTerritoryCenter(target: Player): TileRef | null {
    return calculateTerritoryCenter(this.mg, target);
  }

  // MIRV Execution Methods
  private sendMIRV(tile: TileRef): void {
    this.triggerMIRVCooldown(tile);
    this.mg.addExecution(new MirvExecution(this.player, tile));
  }

  private triggerMIRVCooldown(tile?: TileRef): void {
    this.removeOldMIRVEvents();
    const tick = this.mg.ticks();
    // Use provided tile or any tile from player's territory for cooldown tracking
    const cooldownTile =
      tile ?? Array.from(this.player.tiles())[0] ?? this.mg.ref(0, 0);
    this.lastMIRVSent.push([tick, cooldownTile]);
  }

  private removeOldMIRVEvents() {
    const maxAge = MirvStrategy.MIRV_COOLDOWN_TICKS;
    const tick = this.mg.ticks();
    while (
      this.lastMIRVSent.length > 0 &&
      this.lastMIRVSent[0][0] + maxAge <= tick
    ) {
      this.lastMIRVSent.shift();
    }
  }
}
