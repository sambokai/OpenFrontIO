import { Game, Player, PlayerID, Relation } from "../../game/Game";

export class DiplomacyStrategy {
  private readonly embargoMalusApplied = new Set<PlayerID>();

  constructor(
    private mg: Game,
    private player: Player,
  ) {}

  public manageRelations(): void {
    this.updateRelationsFromEmbargos();
    this.handleEmbargoesToHostileNations();
  }

  private updateRelationsFromEmbargos(): void {
    const others = this.mg.players().filter((p) => p.id() !== this.player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(this.player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(this.player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations(): void {
    const others = this.mg.players().filter((p) => p.id() !== this.player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        this.player.relation(other) <= Relation.Hostile &&
        !this.player.hasEmbargoAgainst(other) &&
        !this.player.isOnSameTeam(other)
      ) {
        this.player.addEmbargo(other, false);
      } else if (
        this.player.relation(other) >= Relation.Neutral &&
        this.player.hasEmbargoAgainst(other)
      ) {
        this.player.stopEmbargo(other);
      }
    });
  }

  /**
   * TODO: Implement strategic betrayal logic
   * Currently this just breaks alliances without strategic consideration.
   * Future implementation should consider:
   * - Relative strength (troop count, territory size) compared to target
   * - Risk vs reward of betrayal
   * - Potential impact on relations with other players
   * - Timing (don't betray when already fighting other enemies)
   * - Strategic value of target's territory
   * - If target is distracted
   */
  public maybeConsiderBetrayal(target: Player): boolean {
    const alliance = this.player.allianceWith(target);

    if (!alliance) return false;

    this.player.breakAlliance(alliance);

    return true;
  }
}
