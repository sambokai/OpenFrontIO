import {
  Cell,
  Game,
  Gold,
  Player,
  PlayerType,
  Tick,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef, euclDistFN } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { boundingBoxTiles } from "../../Util";
import { NukeExecution } from "../NukeExecution";
import { closestTwoTiles } from "../Util";

export class NukeStrategy {
  private readonly lastNukeSent: [Tick, TileRef][] = [];

  constructor(
    private mg: Game,
    private player: Player,
    private random: PseudoRandom,
  ) {}

  public considerNuke(target: Player): void {
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      target.type() === PlayerType.Bot || // Don't nuke bots (as opposed to fakehumans and humans)
      this.player.isOnSameTeam(target)
    ) {
      return;
    }

    const nukeType =
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
        ? UnitType.HydrogenBomb
        : UnitType.AtomBomb;
    const range = nukeType === UnitType.HydrogenBomb ? 60 : 15;

    const structures = target.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles = this.randTerritoryTileArray(10);
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = 0;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      const boundingBox = boundingBoxTiles(this.mg, tile, range)
        // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
        .concat(boundingBoxTiles(this.mg, tile, Math.floor(range / 2)));
      for (const t of boundingBox) {
        // Make sure we nuke away from the border
        if (this.mg.owner(t) !== target) {
          continue outer;
        }
      }
      if (!this.player.canBuild(nukeType, tile)) continue;
      const value = this.nukeTileScore(tile, silos, structures);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile, nukeType);
    }
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }

  private randTerritoryTileArray(numTiles: number): TileRef[] {
    const boundingBox = this.calculateBoundingBox();
    const tiles: TileRef[] = [];
    for (let i = 0; i < numTiles; i++) {
      const tile = this.randTerritoryTile(boundingBox);
      if (tile !== null) {
        tiles.push(tile);
      }
    }
    return tiles;
  }

  private calculateBoundingBox(): {
    min: { x: number; y: number };
    max: { x: number; y: number };
  } {
    const borderTiles = Array.from(this.player.borderTiles());
    if (borderTiles.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tile of borderTiles) {
      const x = this.mg.x(tile);
      const y = this.mg.y(tile);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  }

  private randTerritoryTile(boundingBox: {
    min: { x: number; y: number };
    max: { x: number; y: number };
  }): TileRef | null {
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) === this.player) {
        return randTile;
      }
    }
    return null;
  }

  private removeOldNukeEvents() {
    const maxAge = 500;
    const tick = this.mg.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private sendNuke(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
  ) {
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(new NukeExecution(nukeType, this.player, tile));
  }

  private nukeTileScore(tile: TileRef, silos: Unit[], targets: Unit[]): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit): number => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 10_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Avoid areas defended by SAM launchers
    const dist50 = euclDistFN(tile, 50, false);
    tileValue -=
      50_000 *
      targets.filter(
        (unit) =>
          unit.type() === UnitType.SAMLauncher && dist50(this.mg, unit.tile()),
      ).length;

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }
}
