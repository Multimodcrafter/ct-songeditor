{
  description = "Development environment for the ChurchTools song editor";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          platform = {
            x86_64-linux = "linux-64";
            aarch64-linux = "linux-arm64";
            aarch64-darwin = "darwin-arm64";
          }.${system};
          lock = builtins.fromJSON (builtins.readFile ./package-lock.json);
          runtime = lock.packages."node_modules/@cloudflare/workerd-${platform}";
          workerd = pkgs.stdenv.mkDerivation {
            pname = "workerd";
            inherit (runtime) version;
            src = pkgs.fetchurl {
              url = runtime.resolved;
              hash = runtime.integrity;
            };
            nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
            buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.stdenv.cc.cc.lib
              pkgs.llvmPackages.libcxx
              pkgs.llvmPackages.libunwind
            ];
            dontBuild = true;
            installPhase = ''
              runHook preInstall
              install -Dm755 bin/workerd "$out/bin/workerd"
              runHook postInstall
            '';
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.git
              workerd
            ];

            # Use the native Nix binary, including on NixOS where the npm
            # package's dynamically linked workerd executable cannot run.
            MINIFLARE_WORKERD_PATH = "${workerd}/bin/workerd";
          };
        });
    };
}
