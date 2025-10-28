import { Game, Player, PlayerType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import { EmojiExecution } from "../EmojiExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";
import { BotBehavior, EMOJI_HECKLE } from "../utils/BotBehavior";

export class AttackStrategy {
  private readonly lastEmojiSent = new Map<Player, number>();

  constructor(
    private mg: Game,
    private player: Player,
    private random: PseudoRandom,
    private behavior: BotBehavior,
  ) {}

  public considerAttacks(): void {
    this.maybeAttack();
  }

  private maybeAttack(): void {
    const enemyborder = Array.from(this.player.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter(
        (t) =>
          this.mg.isLand(t) && this.mg.ownerID(t) !== this.player.smallID(),
      );

    if (enemyborder.length === 0) {
      if (this.random.chance(10)) {
        this.sendBoatRandomly();
      }
      return;
    }
    if (this.random.chance(20)) {
      this.sendBoatRandomly();
      return;
    }

    const borderPlayers = enemyborder.map((t) =>
      this.mg.playerBySmallID(this.mg.ownerID(t)),
    );
    if (borderPlayers.some((o) => !o.isPlayer())) {
      this.behavior.sendAttack(this.mg.terraNullius());
      return;
    }

    const enemies = borderPlayers
      .filter((o) => o.isPlayer())
      .sort((a, b) => a.troops() - b.troops());

    // 5% chance to send a random alliance request
    if (this.random.chance(20)) {
      const toAlly = this.random.randElement(enemies);
      if (this.player.canSendAllianceRequest(toAlly)) {
        this.mg.addExecution(
          new AllianceRequestExecution(this.player, toAlly.id()),
        );
      }
    }

    this.behavior.forgetOldEnemies();
    this.behavior.assistAllies();

    const enemy = this.behavior.selectEnemy(enemies);
    if (!enemy) return;
    this.maybeSendEmoji(enemy);
    if (this.player.sharesBorderWith(enemy)) {
      this.behavior.sendAttack(enemy);
    } else {
      this.maybeSendBoatAttack(enemy);
    }
  }

  public maybeSendEmoji(enemy: Player): void {
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.mg.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.mg.ticks());
    this.mg.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(EMOJI_HECKLE),
      ),
    );
  }

  private maybeSendBoatAttack(other: Player): void {
    if (this.player.isFriendly(other)) return;
    const closest = closestTwoTiles(
      this.mg,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      ),
      Array.from(other.borderTiles()).filter((t) => this.mg.isOceanShore(t)),
    );
    if (closest === null) {
      return;
    }
    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        other.id(),
        closest.y,
        this.player.troops() / 5,
        null,
      ),
    );
  }

  public sendBoatRandomly(): void {
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    if (oceanShore.length === 0) {
      return;
    }

    const src = this.random.randElement(oceanShore);

    const dst = this.randomBoatTarget(src, 150);
    if (dst === null) {
      return;
    }

    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        this.mg.owner(dst).id(),
        dst,
        this.player.troops() / 5,
        null,
      ),
    );
  }

  private randomBoatTarget(tile: TileRef, dist: number): TileRef | null {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - dist, x + dist);
      const randY = this.random.nextInt(y - dist, y + dist);
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (!this.mg.isLand(randTile)) {
        continue;
      }
      const owner = this.mg.owner(randTile);
      if (!owner.isPlayer()) {
        return randTile;
      }
      if (!owner.isFriendly(this.player)) {
        return randTile;
      }
    }
    return null;
  }
}
