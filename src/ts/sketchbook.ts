import "../css/main.css";
import { World } from "./world/World";

// The application needs a .glb file to load the full world scene.
// The original project contained a .blend file which was likely
// converted to .glb during the Webpack build process.
// This conversion step is missing in the new Vite setup.
//
// To allow the application to start, it is being initialized
// with an empty world.
//
// If you want to load the full world, you need to:
// 1. Manually convert 'src/blend/world.blend' to 'world.glb'.
// 2. Create a 'public' directory in the project root.
// 3. Place 'world.glb' inside the 'public' directory.
// 4. Change the line below from 'new World()' to "new World('world.glb')".
new World("world.glb");
