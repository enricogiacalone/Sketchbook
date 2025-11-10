import { Character } from "../Character";
import { ICharacterState } from "../../interfaces/ICharacterState";
import { CharacterStateBase } from "./CharacterStateBase";
import { Idle } from "./Idle";

export class Rolling extends CharacterStateBase implements ICharacterState {
  constructor(character: Character) {
    super(character);

    this.character.velocitySimulator.damping = 0.6;
    this.character.rotationSimulator.damping = 0.8;
    this.character.setArcadeVelocityTarget(0.8);
    this.playAnimation("jump_idle", 0.1);
  }

  public update(timeStep: number): void {
    super.update(timeStep);

    if (this.animationEnded(timeStep)) {
      this.character.setState(new Idle(this.character));
    }
  }
}
