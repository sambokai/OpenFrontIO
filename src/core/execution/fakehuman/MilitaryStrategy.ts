import { Cell, Game, Gold, Player, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";
import { structureSpawnTileValue } from "../nation/structureSpawnTileValue";

export class MilitaryStrategy {
  constructor(
    private mg: Game,
    private player: Player,
    private random: PseudoRandom,
  ) {}

  public manageMilitary(): boolean {
    return (
      this.maybeSpawnWarship() ||
      this.maybeSpawnStructure(UnitType.DefensePost, (num) => (num + 2) ** 2) ||
      this.maybeSpawnStructure(UnitType.SAMLauncher, (num) => num ** 2) ||
      this.maybeSpawnStructure(UnitType.MissileSilo, (num) => num ** 2)
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
    const tiles = this.randTerritoryTileArray(25);
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

  private maybeSpawnWarship(): boolean {
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        console.warn("cannot spawn destroyer");
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, targetTile),
      );
      return true;
    }
    return false;
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

  private warshipSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(portTile) - radius,
        this.mg.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(portTile) - radius,
        this.mg.y(portTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.mg.ref(randX, randY);
      // Sanity check
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    return this.mg.unitInfo(type).cost(this.player);
  }
}
