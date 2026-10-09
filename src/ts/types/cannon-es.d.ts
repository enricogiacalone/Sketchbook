import * as CANNON from "cannon-es";

declare module "cannon-es" {
  export interface Body {
    userData?: any;
  }
}
