import Swal from "sweetalert2";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { World } from "~/world/World";
import { LoadingTrackerEntry } from "./LoadingTrackerEntry";
import { UIManager } from "./UIManager";

export class LoadingManager {
  public firstLoad: boolean = true;
  public onFinishedCallback: () => void;

  private world: World;
  private gltfLoader: GLTFLoader;
  private loadingTracker: LoadingTrackerEntry[] = [];

  constructor(world: World) {
    this.world = world;
    this.gltfLoader = new GLTFLoader();

    this.world.setTimeScale(0);
    UIManager.setUserInterfaceVisible(false);
    UIManager.setLoadingScreenVisible(true);
  }

  public loadGLTF(path: string, onLoadingFinished: (gltf: any) => void): void {
    const trackerEntry = this.addLoadingEntry(path);

    fetch(path)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load resource: ${path} (HTTP status ${response.status})`
          );
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("text/html") !== -1) {
          throw new Error(
            `Failed to load 3D model at '${path}'. The server returned an HTML page instead. This usually means the file is missing. Please make sure you have converted 'world.blend' to 'world.glb' and placed it in the 'public' directory.`
          );
        }
        return response.arrayBuffer();
      })
      .then((data) => {
        this.gltfLoader.parse(
          data,
          "",
          (gltf) => {
            onLoadingFinished(gltf);
            this.doneLoading(trackerEntry);
          },
          (error) => {
            console.error(error);
            throw new Error(`Failed to parse GLTF file at '${path}': ${error}`);
          }
        );
      })
      .catch((error) => {
        console.error(error);
        Swal.fire({
          icon: "error",
          title: "Failed to load world",
          text: error.message,
          footer: "Please check the browser console for more details.",
        });
      });
  }

  public addLoadingEntry(path: string): LoadingTrackerEntry {
    let entry = new LoadingTrackerEntry(path);
    this.loadingTracker.push(entry);

    return entry;
  }

  public doneLoading(trackerEntry: LoadingTrackerEntry): void {
    trackerEntry.finished = true;
    trackerEntry.progress = 1;

    if (this.isLoadingDone()) {
      if (this.onFinishedCallback !== undefined) {
        this.onFinishedCallback();
      } else {
        UIManager.setUserInterfaceVisible(true);
      }

      UIManager.setLoadingScreenVisible(false);
    }
  }

  private isLoadingDone(): boolean {
    for (const entry of this.loadingTracker) {
      if (!entry.finished) return false;
    }
    return true;
  }
}
