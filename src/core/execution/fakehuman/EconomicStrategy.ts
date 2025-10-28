import { Cell, Game, Gold, Player, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { calculateBoundingBox } from "../../Util";
import { ConstructionExecution } from "../ConstructionExecution";
import { structureSpawnTileValue } from "../nation/structureSpawnTileValue";

export class EconomicStrategy {
  constructor(
    private mg: Game,
    private player: Player,
    private random: PseudoRandom,
  ) {}

  public manageEconomy(): boolean {
    return (
      this.maybeSpawnStructure(UnitType.City, (num) => num) ||
      this.maybeSpawnStructure(UnitType.Port, (num) => num) ||
      this.maybeSpawnStructure(UnitType.Factory, (num) => num)
    );
  }

  private maybeSpawnStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ): boolean {
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);
    if (this.player.gold() < perceivedCost) {
      return false;
    }
    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : this.randTerritoryTileArray(25);
    if (tiles.length === 0) return null;
    const valueFunction = structureSpawnTileValue(this.mg, this.player, type);
    let bestTile: TileRef | null = null;
    let bestValue = 0;
    for (const t of tiles) {
      const v = valueFunction(t);
      if (v <= bestValue && bestTile !== null) continue;
      if (!this.player.canBuild(type, t)) continue;
      // Found a better tile
      bestTile = t;
      bestValue = v;
    }
    return bestTile;
  }

  private randCoastalTileArray(numTiles: number): TileRef[] {
    const tiles = Array.from(this.player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    return Array.from(this.arraySampler(tiles, numTiles));
  }

  private *arraySampler<T>(a: T[], sampleSize: number): Generator<T> {
    if (a.length <= sampleSize) {
      // Return all elements
      yield* a;
    } else {
      // Sample `sampleSize` elements
      const remaining = new Set<T>(a);
      while (sampleSize--) {
        const t = this.random.randFromSet(remaining);
        remaining.delete(t);
        yield t;
      }
    }
  }

  private randTerritoryTileArray(numTiles: number): TileRef[] {
    const boundingBox = calculateBoundingBox(
      this.mg,
      this.player.borderTiles(),
    );
    const tiles: TileRef[] = [];
    for (let i = 0; i < numTiles; i++) {
      const tile = this.randTerritoryTile(this.player, boundingBox);
      if (tile !== null) {
        tiles.push(tile);
      }
    }
    return tiles;
  }

  private randTerritoryTile(
    p: Player,
    boundingBox: { min: Cell; max: Cell } | null = null,
  ): TileRef | null {
    boundingBox ??= calculateBoundingBox(this.mg, p.borderTiles());
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) === p) {
        return randTile;
      }
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }
}
