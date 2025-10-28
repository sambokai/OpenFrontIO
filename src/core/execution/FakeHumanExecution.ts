import { Execution, Game, Nation, Player, TerrainType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { AttackStrategy } from "./fakehuman/AttackStrategy";
import { DiplomacyStrategy } from "./fakehuman/DiplomacyStrategy";
import { EconomicStrategy } from "./fakehuman/EconomicStrategy";
import { MilitaryStrategy } from "./fakehuman/MilitaryStrategy";
import { MirvStrategy } from "./fakehuman/MirvStrategy";
import { NukeStrategy } from "./fakehuman/NukeStrategy";
import { SpawnExecution } from "./SpawnExecution";
import { BotBehavior } from "./utils/BotBehavior";

export class FakeHumanExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behavior: BotBehavior | null = null; // Shared behavior logic for both bots and fakehumans
  private mg: Game;
  private player: Player | null = null;
  private mirvStrategy: MirvStrategy | null = null;
  private nukeStrategy: NukeStrategy | null = null;
  private economicStrategy: EconomicStrategy | null = null;
  private militaryStrategy: MilitaryStrategy | null = null;
  private diplomacyStrategy: DiplomacyStrategy | null = null;
  private attackStrategy: AttackStrategy | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  constructor(
    gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.FakeHuman
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  init(mg: Game) {
    this.mg = mg;
    if (this.random.chance(10)) {
      // this.isTraitor = true
    }
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) {
      return;
    }

    if (this.mg.inSpawnPhase()) {
      const rl = this.randomSpawnLand();
      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }
      this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, rl));
      return;
    }

    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
      if (this.player === null) {
        return;
      }
      this.mirvStrategy = new MirvStrategy(this.mg, this.player, this.random);
      this.nukeStrategy = new NukeStrategy(this.mg, this.player, this.random);
      this.economicStrategy = new EconomicStrategy(
        this.mg,
        this.player,
        this.random,
      );
      this.militaryStrategy = new MilitaryStrategy(
        this.mg,
        this.player,
        this.random,
      );
      this.diplomacyStrategy = new DiplomacyStrategy(this.mg, this.player);
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      // Player is unavailable during init()
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.player,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );
      this.attackStrategy = new AttackStrategy(
        this.mg,
        this.player,
        this.random,
        this.behavior,
      );

      // Send an attack on the first tick
      this.behavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    this.diplomacyStrategy?.manageRelations();
    this.behavior.handleAllianceRequests();
    this.behavior.handleAllianceExtensionRequests();
    this.economicStrategy?.manageEconomy();
    this.militaryStrategy?.manageMilitary();
    if (this.mirvStrategy) {
      const mirvTarget = this.mirvStrategy.considerMIRV();
      if (mirvTarget) {
        this.attackStrategy?.maybeSendEmoji(mirvTarget);
        this.mirvStrategy.launchMirv(mirvTarget);
      }
    }
    this.attackStrategy?.considerAttacks();
  }

  randomSpawnLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
