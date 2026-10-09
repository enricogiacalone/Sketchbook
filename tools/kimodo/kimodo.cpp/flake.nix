{
  description = "Kimodo GGML C++23 development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/4bd9165a9165d7b5e33ae57f3eecbcb28fb231c9";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in {
      devShells = eachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            # `hf` is supplied by huggingface-hub.  It is deliberately a dev
            # shell tool, never a build input: model downloads remain explicit
            # and licence-gated.
            packages = [ pkgs.cmake pkgs.ninja pkgs.clang pkgs.pkg-config pkgs.vulkan-loader pkgs.vulkan-headers pkgs.shaderc pkgs.vulkan-tools pkgs.python3Packages.huggingface-hub pkgs.python3Packages.numpy ];
            shellHook = ''
              export LD_LIBRARY_PATH="${pkgs.vulkan-loader}/lib:/run/opengl-driver/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            '';
          };
          fuzz = pkgs.mkShell {
            packages = [ pkgs.cmake pkgs.ninja pkgs.clang pkgs.llvm pkgs.pkg-config pkgs.python3Packages.huggingface-hub ];
          };
        });
    };
}
