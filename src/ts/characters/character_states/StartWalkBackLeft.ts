import { StartWalkBase } from "./_stateLibrary";
import { Character } from "~/characters/Character";

export class StartWalkBackLeft extends StartWalkBase {
  constructor(character: Character) {
    super(character);
    this.animationLength = character.setAnimation("start_back_left", 0.1);
  }
}
