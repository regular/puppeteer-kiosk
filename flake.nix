{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils, ... }:
  {
    homeManagerModules = {
      default = ./service.nix;
    };
  } //
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        buildInputs = with pkgs; [ 
          systemd
          #ungoogled-chromium
        ];
      in with pkgs; {

        packages.default = buildNpmPackage rec {
          name = "browserctl";
          src = ./.;
          npmDepsHash = "sha256-Fnwv21iMq9dnX+TNqokP8oN10/OOJB47hwhFuJz/+DY=";

          dontNpmBuild = true;
          makeCacheWritable = true;

          inherit buildInputs;
          nativeBuildInputs = [
            nodejs
            makeWrapper
            pkg-config
            python3
          ];

          postInstall = ''
            # Install the man page
            mkdir -p $out/share/man/man1
            cp man/man1/browserctl.1 $out/share/man/man1/
          '';

          #postInstall = ''
          #  wrapProgram $out/bin/browserctl \
          #  --set browserctl_executable-path ${browserPkg}
          #'';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            ungoogled-chromium
            systemd
            nodejs
            pkg-config
            python3
          ];
        };
      }
    );
}
